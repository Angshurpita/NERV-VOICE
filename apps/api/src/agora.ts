import agoraToken from 'agora-token';
import { EventEmitter } from 'node:events';
import {
  AgoraClient,
  Agent,
  Area,
  DeepgramSTT,
  Gemini,
  MiniMaxTTS,
  type AgentSession,
} from 'agora-agents';
import { config } from './config.js';

const {
  RtcRole,
  RtcTokenBuilder,
  RtmTokenBuilder,
  SttTokenBuilder,
  ConvoAITokenBuilder,
} = agoraToken;

export interface AgoraChannelTokens {
  appId: string;
  channelName: string;
  uid: number;
  rtcToken: string;
  rtmToken: string;
  sttToken?: string;
  convoAiToken?: string;
  expiresAt: number;
}

export interface SignallingEvent {
  id: string;
  callId: string;
  event: 'call_started' | 'caller_utterance' | 'gemini_thinking' | 'agent_reply' | 'escalation_triggered' | 'call_ended' | 'ping';
  payload: Record<string, unknown>;
  timestamp: string;
}

class AgoraService {
  private readonly emitter = new EventEmitter();
  private readonly recentEvents: SignallingEvent[] = [];
  private readonly activeSessions = new Map<string, AgentSession>();
  private agentClient: AgoraClient | null = null;

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  private getAgentClient(): AgoraClient {
    if (!this.agentClient) {
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

  get isConfigured(): boolean {
    return Boolean(config.agora.appId && config.agora.appCertificate);
  }

  /**
   * Generates Agora RTC, Signalling (RTM), SST (STT), and Conversational AI tokens.
   */
  generateTokens(channelName: string, uidInput?: number | string): AgoraChannelTokens {
    if (!this.isConfigured) {
      throw new Error('Agora credentials (AGORA_APP_ID, AGORA_APP_CERTIFICATE) are not configured.');
    }

    const uid = typeof uidInput === 'number' && !isNaN(uidInput) ? uidInput : 0;
    const rtmUid = String(uid || `user_${Math.random().toString(36).slice(2, 8)}`);
    const expiresAt = Math.floor(Date.now() / 1000) + config.agora.tokenTtlSeconds;

    // 1. Standard Agora RTC Audio Token (Voice Channel)
    const rtcToken = RtcTokenBuilder.buildTokenWithUid(
      config.agora.appId,
      config.agora.appCertificate,
      channelName,
      uid,
      RtcRole.PUBLISHER,
      expiresAt,
      expiresAt,
    );

    // 2. Agora Signalling (RTM) Token (Real-Time Control & State)
    const rtmToken = RtmTokenBuilder.buildToken(
      config.agora.appId,
      config.agora.appCertificate,
      rtmUid,
      expiresAt,
    );

    let sttToken: string | undefined;
    try {
      // 3. Agora SST / Realtime STT Token
      sttToken = SttTokenBuilder.buildToken(
        config.agora.appId,
        config.agora.appCertificate,
        channelName,
        rtmUid,
        RtcRole.PUBLISHER,
        expiresAt,
        expiresAt,
        expiresAt,
        expiresAt,
        expiresAt,
        rtmUid,
        expiresAt,
      );
    } catch {
      // Fall back gracefully if specialized service constructor differs
      sttToken = undefined;
    }

    let convoAiToken: string | undefined;
    try {
      // 4. Agora Conversational AI Unified Token
      convoAiToken = ConvoAITokenBuilder.buildToken(
        config.agora.appId,
        config.agora.appCertificate,
        channelName,
        rtmUid,
        RtcRole.PUBLISHER,
        expiresAt,
        expiresAt,
        expiresAt,
        expiresAt,
        expiresAt,
        rtmUid,
        expiresAt,
      );
    } catch {
      convoAiToken = undefined;
    }

    return {
      appId: config.agora.appId,
      channelName,
      uid,
      rtcToken,
      rtmToken,
      sttToken,
      convoAiToken,
      expiresAt,
    };
  }

  /**
   * Broadcast real-time signalling event across connected consoles and callers.
   */
  publishSignalling(
    callId: string,
    event: SignallingEvent['event'],
    payload: Record<string, unknown> = {},
  ): SignallingEvent {
    const item: SignallingEvent = {
      id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      callId,
      event,
      payload,
      timestamp: new Date().toISOString(),
    };

    this.recentEvents.push(item);
    if (this.recentEvents.length > 500) {
      this.recentEvents.shift();
    }

    this.emitter.emit('event', item);
    this.emitter.emit(`call:${callId}`, item);
    return item;
  }

  /**
   * Subscribe to signalling stream.
   */
  subscribe(listener: (event: SignallingEvent) => void, callId?: string): () => void {
    const eventName = callId ? `call:${callId}` : 'event';
    this.emitter.on(eventName, listener);
    return () => {
      this.emitter.off(eventName, listener);
    };
  }

  getRecentEvents(callId?: string, limit = 50): SignallingEvent[] {
    const list = callId
      ? this.recentEvents.filter((e) => e.callId === callId)
      : this.recentEvents;
    return list.slice(-limit);
  }

  /**
   * Starts an Agora Cloud Conversational AI Agent in the RTC channel.
   */
  async startConversationalAgent(
    channelName: string,
    language: string = 'en',
    customGreeting?: string,
  ) {
    if (!config.agora.cloudAgentEnabled) {
      return {
        ok: false,
        enabled: false,
        message: 'Agora Customer ID or Secret not configured for Cloud Agent.',
      };
    }

    // Stop any existing session on this channel first
    const existing = this.activeSessions.get(channelName);
    if (existing) {
      try {
        await existing.stop();
      } catch {
        // ignore
      }
      this.activeSessions.delete(channelName);
    }

    const agentRtcUid = 10001;
    const isHindi = language === 'hi';
    const greetingText =
      customGreeting ||
      (isHindi
        ? 'नमस्ते, कॉल करने के लिए धन्यवाद। मैं आपके ऑर्डर की स्थिति जाँचने, डिलीवरी या प्रोडक्ट से जुड़ी समस्या में मदद करने, या आपको कस्टमर सर्विस एजेंट से जोड़ने में मदद कर सकता हूँ। बताइए, कैसे मदद करूँ?'
        : 'Hi, thanks for calling. I can help you check your order status, assist with delivery or product issues, or connect you with a customer service agent. How can I help today?');

    const instructions = `You are the official Voice Agent for customer support at Nerv, an Indian e-commerce company.
You are interacting on a live Agora RTC voice call.
- Keep your answers brief, human, and conversational (1 to 2 sentences max).
- Speak in ${isHindi ? 'Hindi' : 'English'}.
- Help customers with order status, returns, cancellations, and inquiries.
- If the customer asks for a human agent or requires complex resolution, inform them politely that you are connecting them to human support.
- Do not independently answer caller audio. The Nerv backend owns policy, order verification, escalation, and every reply. Only speak text explicitly sent through the session.`;

    try {
      const client = this.getAgentClient();
      const agent = new Agent({
        client,
        instructions,
        greeting: greetingText,
      })
        .withStt(new DeepgramSTT({ model: 'nova-2', language: isHindi ? 'hi' : 'en-US' }))
        .withLlm(
          new Gemini({
            apiKey: config.gemini.apiKey,
            model: config.gemini.model,
            maxHistory: 1,
            temperature: 0.3,
            maxOutputTokens: 512,
            systemMessages: [
              {
                role: 'system',
                content:
                  'Do not independently answer caller audio. The Nerv backend owns policy, order verification, escalation, and every reply. Only speak text explicitly sent through the session.',
              },
            ],
          }),
        )
        // Agora-managed MiniMax publishes a remote RTC audio track. There is
        // no browser TTS or Web Audio substitute for this path.
        .withTts(new MiniMaxTTS({ model: 'speech-2.6-turbo' }));

      const session = agent.createSession({
        channel: channelName,
        agentUid: String(agentRtcUid),
        remoteUids: ['*'],
      });

      const agentId = await session.start();
      this.activeSessions.set(channelName, session);

      this.publishSignalling(channelName, 'agent_reply', {
        reply: greetingText,
        source: 'agora_cloud_agent',
        agentId,
      });

      return {
        ok: true,
        agentId,
        agentRtcUid,
        channelName,
        greeting: greetingText,
      };
    } catch (e: any) {
      console.error('[AgoraService] Failed to start Conversational AI Agent:', e);
      return { ok: false, error: e.message };
    }
  }

  /**
   * Sends text to be spoken into the channel by the Agora Cloud Conversational AI Agent.
   */
  async speakConversationalAgent(channelName: string, text: string) {
    const session = this.activeSessions.get(channelName);
    if (!session) {
      return { ok: false, message: 'No active Agora agent session found for channel.' };
    }

    try {
      await session.say(text);
      this.publishSignalling(channelName, 'agent_reply', {
        reply: text,
        source: 'agora_cloud_agent',
      });
      return { ok: true };
    } catch (e: any) {
      console.error('[AgoraService] Failed to make agent speak:', e);
      return { ok: false, error: e.message };
    }
  }

  /**
   * Stops an Agora Cloud Conversational AI Agent.
   */
  async stopConversationalAgent(channelName: string, _agentName?: string) {
    const session = this.activeSessions.get(channelName);
    if (!session) {
      return { ok: true, message: 'No active session to stop.' };
    }

    try {
      await session.stop();
    } catch (e: any) {
      console.warn('[AgoraService] Agent session stop notice:', e.message);
    } finally {
      this.activeSessions.delete(channelName);
    }
    return { ok: true };
  }
}

export const agoraService = new AgoraService();
