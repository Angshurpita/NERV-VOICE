import agoraToken from "agora-token";
import { EventEmitter } from "node:events";
import { getDatabase } from "@echosphere/db";
import type { LanguageCode } from "@echosphere/core";
import { config, getSystemStatus } from "./config.js";
import { agentWorker } from "./agent-worker.js";
import { logVoiceDiagnostic } from "./diagnostics.js";

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
  event:
    | "call_started"
    | "caller_utterance"
    | "gemini_thinking"
    | "agent_reply"
    | "escalation_triggered"
    | "call_ended"
    | "ping";
  payload: Record<string, unknown>;
  timestamp: string;
}

class AgoraService {
  private readonly emitter = new EventEmitter();
  private readonly recentEvents: SignallingEvent[] = [];

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  get isConfigured(): boolean {
    return Boolean(config.agora.appId && config.agora.appCertificate);
  }

  get cloudAgentConfigured(): boolean {
    return config.agora.cloudAgentEnabled;
  }

  /**
   * Generates Agora RTC, Signalling (RTM), SST (STT), and Conversational AI tokens.
   */
  generateTokens(
    channelName: string,
    uidInput?: number | string,
  ): AgoraChannelTokens {
    if (!this.isConfigured) {
      throw new Error(
        "Agora credentials (AGORA_APP_ID, AGORA_APP_CERTIFICATE) are not configured.",
      );
    }

    const uid = typeof uidInput === "number" && !isNaN(uidInput) ? uidInput : 0;
    const rtmUid = String(
      uid || `user_${Math.random().toString(36).slice(2, 8)}`,
    );
    const expiresAt =
      Math.floor(Date.now() / 1000) + config.agora.tokenTtlSeconds;

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
      sttToken = undefined;
    }

    let convoAiToken: string | undefined;
    try {
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

    logVoiceDiagnostic("AGORA_TOKEN_CREATED", {
      channelName,
      uid,
    });

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
    event: SignallingEvent["event"],
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

    this.emitter.emit("event", item);
    this.emitter.emit(`call:${callId}`, item);
    return item;
  }

  /**
   * Subscribe to signalling stream.
   */
  subscribe(
    listener: (event: SignallingEvent) => void,
    callId?: string,
  ): () => void {
    const eventName = callId ? `call:${callId}` : "event";
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
   * Starts an Agora Cloud Conversational AI Agent in the channel.
   */
  async startConversationalAgent(
    channelName: string,
    language: LanguageCode = "en",
    customGreeting?: string,
    explicitCallId?: string,
  ) {
    if (!config.agora.cloudAgentEnabled) {
      return {
        ok: false,
        enabled: false,
        message: "Agora Customer ID or Secret not configured for Cloud Agent.",
      };
    }

    // Resolve callId deterministically from channel or explicit parameter
    let callId = explicitCallId;
    if (!callId) {
      try {
        const db = await getDatabase(config.DATABASE_URL);
        const call = await db.calls.findByChannel(channelName);
        if (call) {
          callId = call.id;
        }
      } catch {
        // ignore
      }
    }
    if (!callId) {
      callId = channelName.startsWith("nerv_")
        ? channelName.slice(5)
        : channelName;
    }

    return agentWorker.startSession({
      callId,
      channelName,
      language,
      customGreeting,
    });
  }

  /**
   * Stops an Agora Cloud Conversational AI Agent session cleanly.
   */
  async stopConversationalAgent(channelName: string, _agentName?: string) {
    return agentWorker.stopSession(channelName);
  }

  /**
   * Get detailed health and capability status.
   * "agentActive" is true ONLY if actual agent sessions are running.
   */
  getStatus() {
    const sys = getSystemStatus();
    const activeCount = agentWorker.getActiveCount();
    return {
      enabled: this.isConfigured,
      appId: config.agora.appId ? `${config.agora.appId.slice(0, 6)}...` : null,
      rtcConfigured: sys.agora.voiceRtc,
      cloudAgentConfigured: sys.agora.cloudAgent,
      llmBridgeConfigured: sys.agora.llmBridgeConfigured,
      llmBridgeUrl: sys.agora.llmBridgeUrl,
      sttConfigured: sys.agora.sttConfigured,
      sttProvider: sys.agora.sttProvider,
      sttModel: sys.agora.sttModel,
      ttsConfigured: sys.agora.ttsConfigured,
      ttsProvider: sys.agora.ttsProvider,
      ttsModel: sys.agora.ttsModel,
      activeSessions: activeCount,
      agentActive: activeCount > 0,
      system: sys,
    };
  }
}

export const agoraService = new AgoraService();
