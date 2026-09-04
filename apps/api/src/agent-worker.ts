import {
  AgoraClient,
  Agent,
  Area,
  DeepgramSTT,
  Gemini,
  MiniMaxTTS,
  CustomLLM,
  type AgentSession,
} from 'agora-agents';
import type { LanguageCode } from '@echosphere/core';
import { getDatabase } from '@echosphere/db';
import { config } from './config.js';
import { handleTurn } from './conversation.js';
import { agoraService } from './agora.js';

export interface ManagedSession {
  sessionId: string;
  callId: string;
  channelName: string;
  agentRtcUid: number;
  agentId: string;
  language: LanguageCode;
  session: AgentSession;
  startedAt: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  lastProcessedTurnIndex: number;
  syncInterval: NodeJS.Timeout | null;
  error?: string;
}

export class AgentWorker {
  private readonly sessionsByCallId = new Map<string, ManagedSession>();
  private readonly sessionsByChannel = new Map<string, ManagedSession>();
  private agentClient: AgoraClient | null = null;
  private isShuttingDown = false;

  constructor() {
    process.on('SIGINT', () => void this.shutdownAll());
    process.on('SIGTERM', () => void this.shutdownAll());
  }

  private getClient(): AgoraClient {
    if (!this.agentClient) {
      if (!config.agora.hasCredentials || !config.agora.hasCustomerCredentials) {
        throw new Error(
          'Agora credentials (AGORA_APP_ID, AGORA_APP_CERTIFICATE, AGORA_CUSTOMER_ID, AGORA_CUSTOMER_SECRET) must be set.',
        );
      }
      this.agentClient = new AgoraClient({
        appId: config.agora.appId,
        appCertificate: config.agora.appCertificate,
        customerId: config.agora.customerId,
        customerSecret: config.agora.customerSecret,
        area: Area.US,
      });
    }
    return this.agentClient;
  }

  /**
   * Generates a unique numeric RTC UID for the agent.
   * Avoids fixed UID (e.g. 10001) so simultaneous calls do not collide.
   */
  private generateUniqueAgentUid(): number {
    return Math.floor(200000 + Math.random() * 700000);
  }

  /**
   * Starts a real Agora Conversational AI Agent for a call.
   */
  async startSession(input: {
    callId: string;
    channelName: string;
    language?: LanguageCode;
    customGreeting?: string;
  }): Promise<{
    ok: boolean;
    agentId?: string;
    agentRtcUid?: number;
    channelName?: string;
    greeting?: string;
    message?: string;
    error?: string;
  }> {
    if (this.isShuttingDown) {
      return { ok: false, error: 'Agent Worker is shutting down' };
    }

    if (!config.agora.cloudAgentEnabled) {
      return {
        ok: false,
        message: 'Agora credentials or Cloud Agent customer keys not configured.',
      };
    }

    const { callId, channelName } = input;
    const language = input.language ?? 'en';
    const isHindi = language === 'hi';

    // Stop any previous active session for this call or channel
    await this.stopSession(callId);
    await this.stopSession(channelName);

    const agentRtcUid = this.generateUniqueAgentUid();
    const sessionId = `sess_${callId}_${Date.now()}`;

    const greetingText =
      input.customGreeting ||
      (isHindi
        ? 'नमस्ते, कॉल करने के लिए धन्यवाद। मैं आपके ऑर्डर की स्थिति जाँचने, डिलीवरी या प्रोडक्ट से जुड़ी समस्या में मदद करने, या आपको कस्टमर सर्विस एजेंट से जोड़ने में मदद कर सकता हूँ। बताइए, कैसे मदद करूँ?'
        : 'Hi, thanks for calling. I can help you check your order status, assist with delivery or product issues, or connect you with a customer service agent. How can I help today?');

    try {
      const client = this.getClient();

      // Configure Agent with STT, LLM, and TTS
      const agent = new Agent({
        client,
        turnDetection: {
          language: isHindi ? 'hi-IN' : 'en-US',
          config: {
            speech_threshold: 0.5,
            start_of_speech: {
              mode: 'vad',
              vad_config: {
                interrupt_duration_ms: 160,
                prefix_padding_ms: 300,
              },
            },
            end_of_speech: {
              mode: 'vad',
              vad_config: {
                silence_duration_ms: 480,
              },
            },
          },
        },
        advancedFeatures: {
          enable_rtm: true,
        },
        parameters: {
          data_channel: 'datastream',
          enable_error_message: true,
        },
      })
        // STT: Real Deepgram speech recognition
        .withStt(
          new DeepgramSTT({
            model: isHindi ? 'nova-2' : 'nova-3',
            language: isHindi ? 'hi' : 'en-US',
          }),
        );

      // LLM configuration:
      // If a public backend URL or AGORA_LLM_URL is configured, route Agora STT utterances
      // directly to EchoSphere's custom OpenAI-compatible chat completion endpoint.
      // Otherwise, use a guarded relay LLM that defers to EchoSphere while the persistent
      // worker synchronization loop feeds turns and speaks authoritative responses.
      const baseLlmUrl =
        config.agora.llmUrl ||
        (config.PUBLIC_URL
          ? `${config.PUBLIC_URL}/api/agora/openai/v1/chat/completions`
          : '');
      const llmEndpoint = baseLlmUrl
        ? `${baseLlmUrl}${baseLlmUrl.includes('?') ? '&' : '?'}callId=${encodeURIComponent(callId)}&channel=${encodeURIComponent(channelName)}`
        : '';

      if (llmEndpoint) {
        agent.withLlm(
          new CustomLLM({
            apiKey: config.AUTH_SECRET,
            model: 'echosphere-authoritative-brain',
            url: llmEndpoint,
            vendor: 'custom',
            systemMessages: [
              {
                role: 'system',
                content:
                  'You are the EchoSphere customer support voice relay. The EchoSphere core engine owns all order decisions, verification, and policies.',
              },
            ],
            greetingMessage: greetingText,
          }),
        );
      } else {
        // Guarded Gemini relay LLM for local development mode
        agent.withLlm(
          new Gemini({
            apiKey: config.gemini.apiKey,
            model: config.gemini.model,
            maxHistory: 0,
            maxOutputTokens: 256,
            temperature: 0.2,
            greetingMessage: greetingText,
            systemMessages: [
              {
                role: 'system',
                content:
                  'You are a voice relay for EchoSphere customer service. You do not make policy decisions, verify orders, or invent resolutions. If speaking, only state that you are retrieving the official records from EchoSphere.',
              },
            ],
          }),
        );
      }

      // TTS: Real MiniMax voice publishing to RTC channel
      agent.withTts(
        new MiniMaxTTS({
          model: 'speech_2_6_turbo',
          voiceId: isHindi ? 'Hindi_Male_1' : 'English_captivating_female1',
        }),
      );

      // Create isolated session with unique agent RTC UID
      const session = agent.createSession({
        name: `echosphere-${callId}-${Date.now()}`,
        channel: channelName,
        agentUid: String(agentRtcUid),
        remoteUids: ['*'],
        idleTimeout: 300,
      });

      const agentId = await session.start();

      const managed: ManagedSession = {
        sessionId,
        callId,
        channelName,
        agentRtcUid,
        agentId,
        language,
        session,
        startedAt: new Date().toISOString(),
        status: 'running',
        lastProcessedTurnIndex: -1,
        syncInterval: null,
      };

      this.sessionsByCallId.set(callId, managed);
      this.sessionsByChannel.set(channelName, managed);

      // Persist agent ID & UID into DB call row
      try {
        const db = await getDatabase(config.DATABASE_URL);
        await db.calls.updateAgent(callId, agentId, agentRtcUid);
      } catch (dbErr) {
        console.warn('[AgentWorker] Could not persist agent metadata to DB:', dbErr);
      }

      // Start the real-time turn synchronization loop to bridge recognized speech to EchoSphere
      // when running without a direct public CustomLLM webhook.
      if (!llmEndpoint) {
        this.startTurnSyncLoop(managed);
      }

      // Publish initial agent reply signalling
      agoraService.publishSignalling(callId, 'agent_reply', {
        reply: greetingText,
        source: 'agora_cloud_agent',
        agentId,
        agentRtcUid,
        language,
      });

      return {
        ok: true,
        agentId,
        agentRtcUid,
        channelName,
        greeting: greetingText,
      };
    } catch (err: any) {
      console.error('[AgentWorker] Failed to start Conversational Agent session:', err);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Real-time bridge: poll Agora Agent session history for recognized speech from STT,
   * pass utterance to EchoSphere `handleTurn()`, and speak authoritative reply back via `session.say()`.
   */
  private startTurnSyncLoop(managed: ManagedSession) {
    if (managed.syncInterval) {
      clearInterval(managed.syncInterval);
    }

    let isPolling = false;

    managed.syncInterval = setInterval(async () => {
      if (isPolling || managed.status !== 'running') return;
      isPolling = true;

      try {
        const history = await managed.session.getHistory();
        const contents = history?.contents ?? [];

        for (let i = managed.lastProcessedTurnIndex + 1; i < contents.length; i++) {
          const item = contents[i];
          if (!item) continue;

          // Found a recognized user speech utterance from the caller's microphone
          if (item.role === 'user' && typeof item.content === 'string' && item.content.trim()) {
            const utteranceText = item.content.trim();
            managed.lastProcessedTurnIndex = i;

            // Route recognized caller utterance into EchoSphere authoritative engine
            const outcome = await handleTurn({
              callId: managed.callId,
              text: utteranceText,
              asrConfidence: 0.95,
            });

            if ('reply' in outcome && outcome.reply) {
              // EchoSphere authoritative response -> Real Agora Agent speaks via TTS to caller
              try {
                await managed.session.say(outcome.reply, {
                  interruptable: true,
                });
              } catch (sayErr: any) {
                console.error('[AgentWorker] session.say failed:', sayErr.message);
              }
            }
          }
        }
      } catch (syncErr: any) {
        if (managed.status === 'running') {
          // debug
        }
      } finally {
        isPolling = false;
      }
    }, 800);
  }

  /**
   * Stops an active Agent session cleanly.
   */
  async stopSession(callIdOrChannel: string): Promise<{ ok: boolean; message?: string }> {
    const session =
      this.sessionsByCallId.get(callIdOrChannel) || this.sessionsByChannel.get(callIdOrChannel);

    if (!session) {
      return { ok: true, message: 'No active agent session found.' };
    }

    if (session.syncInterval) {
      clearInterval(session.syncInterval);
      session.syncInterval = null;
    }

    session.status = 'stopping';

    try {
      await session.session.stop();
    } catch (err: any) {
      console.warn('[AgentWorker] Agent stop notice:', err.message);
    } finally {
      session.status = 'stopped';
      this.sessionsByCallId.delete(session.callId);
      this.sessionsByChannel.delete(session.channelName);
    }

    return { ok: true };
  }

  /**
   * Instructs the agent to speak custom authoritative text.
   */
  async speak(callIdOrChannel: string, text: string): Promise<{ ok: boolean; error?: string }> {
    const session =
      this.sessionsByCallId.get(callIdOrChannel) || this.sessionsByChannel.get(callIdOrChannel);

    if (!session) {
      return { ok: false, error: 'No active Agora Agent session found for call/channel.' };
    }

    try {
      await session.session.say(text, { interruptable: true });
      agoraService.publishSignalling(session.callId, 'agent_reply', {
        reply: text,
        source: 'agora_cloud_agent',
      });
      return { ok: true };
    } catch (err: any) {
      console.error('[AgentWorker] Agent speak failed:', err);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Retrieve managed session information.
   */
  getSession(callIdOrChannel: string): ManagedSession | null {
    return (
      this.sessionsByCallId.get(callIdOrChannel) || this.sessionsByChannel.get(callIdOrChannel) || null
    );
  }

  /**
   * Total count of currently active agent sessions.
   */
  getActiveCount(): number {
    return this.sessionsByCallId.size;
  }

  getStatus() {
    return {
      activeSessions: this.sessionsByCallId.size,
      isShuttingDown: this.isShuttingDown,
      sessions: Array.from(this.sessionsByCallId.values()).map((s) => ({
        callId: s.callId,
        channelName: s.channelName,
        agentRtcUid: s.agentRtcUid,
        agentId: s.agentId,
        language: s.language,
        startedAt: s.startedAt,
        status: s.status,
      })),
    };
  }

  /**
   * Terminate all active sessions on shutdown.
   */
  async shutdownAll() {
    this.isShuttingDown = true;
    const calls = Array.from(this.sessionsByCallId.keys());
    for (const callId of calls) {
      try {
        await this.stopSession(callId);
      } catch {
        // ignore
      }
    }
  }
}

export const agentWorker = new AgentWorker();
