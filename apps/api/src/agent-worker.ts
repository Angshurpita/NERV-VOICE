import {
  AgoraClient,
  Agent,
  Area,
  AresSTT,
  DeepgramSTT,
  DeepgramTTS,
  OpenAI,
  OpenAITTS,
  CustomLLM,
  type AgentSession,
} from "agora-agents";
import type { LanguageCode } from "@echosphere/core";
import { getDatabase } from "@echosphere/db";
import { config, isPrivateOrLocalhostUrl } from "./config.js";
import { logVoiceDiagnostic } from "./diagnostics.js";

export interface ManagedSession {
  sessionId: string;
  callId: string;
  channelName: string;
  agentRtcUid: number;
  agentId: string;
  language: LanguageCode;
  session: AgentSession;
  startedAt: string;
  status: "starting" | "running" | "stopping" | "stopped" | "error";
  error?: string;
}

/**
 * Persistent Agent Worker.
 *
 * Coordinates the REAL Agora Conversational AI Agent lifecycle:
 * - Creates authentic Agora Agent instances using Deepgram STT and Deepgram Aura TTS
 * - Routes all caller speech directly into EchoSphere's authoritative CustomLLM endpoint
 * - Maintains zero local conversational fallbacks, zero polling, and zero duplicated turns
 */
export class AgentWorker {
  private readonly sessionsByCallId = new Map<string, ManagedSession>();
  private readonly sessionsByChannel = new Map<string, ManagedSession>();
  private agentClient: AgoraClient | null = null;
  private isShuttingDown = false;

  constructor() {
    process.on("SIGINT", () => void this.shutdownAll());
    process.on("SIGTERM", () => void this.shutdownAll());
  }

  private getClient(): AgoraClient {
    if (!this.agentClient) {
      if (
        !config.agora.hasCredentials ||
        !config.agora.hasCustomerCredentials
      ) {
        throw new Error(
          "Agora credentials (AGORA_APP_ID, AGORA_APP_CERTIFICATE, AGORA_CUSTOMER_ID, AGORA_CUSTOMER_SECRET) must be set.",
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
   *
   * Single authoritative voice pipeline:
   * Caller Microphone -> Agora RTC -> Deepgram STT -> EchoSphere CustomLLM -> Deepgram Aura TTS -> Caller Speaker
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
      return { ok: false, error: "Agent Worker is shutting down" };
    }

    const { callId, channelName } = input;
    const language = input.language ?? "en";
    const isHindi = language === "hi";

    logVoiceDiagnostic("AGORA_AGENT_START_REQUESTED", {
      callId,
      channelName,
      language,
    });

    if (!config.agora.cloudAgentEnabled) {
      return {
        ok: false,
        message:
          "Agora credentials or Cloud Agent customer keys not configured.",
      };
    }

    // Determine the EchoSphere CustomLLM endpoint if available and public
    const baseLlmUrl = config.agora.llmUrl;
    const useCustomLlm = Boolean(baseLlmUrl && !isPrivateOrLocalhostUrl(baseLlmUrl));

    // Stop any previous active session for this call or channel
    await this.stopSession(callId);
    await this.stopSession(channelName);

    const agentRtcUid = this.generateUniqueAgentUid();
    const sessionId = `sess_${callId}_${Date.now()}`;

    try {
      const client = this.getClient();

      // Configure authoritative CustomLLM URL passing deterministic callId & channel
      const targetLlmUrl = `${baseLlmUrl}${baseLlmUrl.includes("?") ? "&" : "?"}callId=${encodeURIComponent(callId)}&channel=${encodeURIComponent(channelName)}`;

      logVoiceDiagnostic("CUSTOM_LLM_URL_RESOLVED", {
        callId,
        channelName,
        targetLlmUrl,
      });

      let agent = new Agent({
        client,
        turnDetection: {
          language: isHindi ? "hi-IN" : "en-US",
          config: {
            speech_threshold: 0.5,
            start_of_speech: {
              mode: "vad",
              vad_config: {
                interrupt_duration_ms: 160,
                prefix_padding_ms: 300,
              },
            },
            end_of_speech: {
              mode: "vad",
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
          data_channel: "datastream",
          enable_error_message: true,
        },
      })
        // 1. STT: Agora Ares ASR (Agora-managed, matches Agora Console)
        .withStt(
          new AresSTT({
            keywords: [
              "order",
              "delivery",
              "problem",
              "help",
              "agent",
              "cancel",
              "refund",
              "status",
              "track",
            ],
          }),
        )
        // 2. TTS: OpenAI TTS with Sage voice (Agora-managed preset, matches Agora Console)
        .withTts(
          new OpenAITTS({
            voice: "sage",
          }),
        );

      // 3. LLM: Either CustomLLM (when public URL provided) or Agora-managed OpenAI preset
      // The agent created in Agora already has its welcome message configured, so do NOT override unless explicitly passed
      if (useCustomLlm) {
        agent = agent.withLlm(
          new CustomLLM({
            apiKey: config.AUTH_SECRET,
            model: config.gemini.model,
            url: targetLlmUrl,
            vendor: "custom",
            headers: {
              "x-call-id": callId,
              "x-channel-name": channelName,
              authorization: `Bearer ${config.AUTH_SECRET}`,
            },
            systemMessages: [
              {
                role: "system",
                content:
                  "You are the Nerv customer support voice assistant. Help callers with their order tracking, delivery issues, refunds, and human escalation.",
              },
            ],
            ...(input.customGreeting ? { greetingMessage: input.customGreeting } : {}),
          }),
        );
      } else {
        agent = agent.withLlm(
          new OpenAI({
            model: "gpt-4o-mini",
            systemMessages: [
              {
                role: "system",
                content:
                  "You are the voice support agent for Nerv e-commerce customer service. Speak concisely, clearly, and helpfully. Assist callers with order tracking, delivery issues, cancellations, and returns.",
              },
            ],
            ...(input.customGreeting ? { greetingMessage: input.customGreeting } : {}),
          }),
        );
      }

      // Create isolated session with unique agent RTC UID
      const session = agent.createSession({
        name: `echosphere-${callId}-${Date.now()}`,
        channel: channelName,
        agentUid: String(agentRtcUid),
        remoteUids: ["*"],
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
        status: "running",
      };

      this.sessionsByCallId.set(callId, managed);
      this.sessionsByChannel.set(channelName, managed);

      // Persist agent ID & UID into DB call row
      try {
        const db = await getDatabase(config.DATABASE_URL);
        await db.calls.updateAgent(callId, agentId, agentRtcUid);
      } catch (dbErr) {
        console.warn(
          "[AgentWorker] Could not persist agent metadata to DB:",
          dbErr,
        );
      }

      logVoiceDiagnostic("AGORA_AGENT_STARTED", {
        callId,
        channelName,
        agentId,
        agentRtcUid,
        sttModel: "agora-ares",
        ttsModel: "openai-tts-1-sage",
        llmUrl: useCustomLlm ? targetLlmUrl : "openai_gpt_4o_mini",
      });

      logVoiceDiagnostic("AGORA_AGENT_JOINED", {
        callId,
        channelName,
        agentId,
        agentRtcUid,
      });

      return {
        ok: true,
        agentId,
        agentRtcUid,
        channelName,
        greeting: input.customGreeting || "",
      };
    } catch (err: any) {
      logVoiceDiagnostic("PIPELINE_ERROR", {
        callId,
        channelName,
        error: err.message,
      });
      return { ok: false, error: err.message };
    }
  }

  /**
   * Stop an active agent session gracefully.
   */
  async stopSession(
    callIdOrChannel: string,
  ): Promise<{ ok: boolean; message?: string }> {
    const session =
      this.sessionsByCallId.get(callIdOrChannel) ||
      this.sessionsByChannel.get(callIdOrChannel);

    if (!session) {
      return { ok: true, message: "No active session found." };
    }

    try {
      session.status = "stopping";
      await session.session.stop();
      session.status = "stopped";
      this.sessionsByCallId.delete(session.callId);
      this.sessionsByChannel.delete(session.channelName);

      logVoiceDiagnostic("AGENT_STOPPED", {
        callId: session.callId,
        channelName: session.channelName,
        agentId: session.agentId,
      });

      return { ok: true };
    } catch (err: any) {
      session.status = "error";
      session.error = err.message;
      this.sessionsByCallId.delete(session.callId);
      this.sessionsByChannel.delete(session.channelName);
      return { ok: false, message: err.message };
    }
  }

  /**
   * Total count of currently active agent sessions.
   */
  getActiveCount(): number {
    return this.sessionsByCallId.size;
  }

  /**
   * Get diagnostic state of all managed sessions.
   */
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
