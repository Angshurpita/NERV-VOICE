import type { LanguageCode } from "@echosphere/core";

const BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:3001";

export interface Scenario {
  id: string;
  title: string;
  orderId: string;
  customerName: string;
  say: string;
  expect: string;
  escalates: boolean;
  language: LanguageCode;
  tags: string[];
}

export interface VerificationState {
  orderId: string | null;
  lookedUp: boolean;
  lookupOutcome: "found" | "not_found" | "backend_unavailable" | null;
  ordererName: string | null;
  readBack: boolean;
  confirmed: boolean;
  nameMatches: boolean | null;
  attempts: number;
}

export interface TurnResponse {
  reply: string;
  language: LanguageCode;
  escalated: boolean;
  escalationReason: string | null;
  caseRef: string | null;
  step: string;
  verification: VerificationState;
  intent: { value: string; confidence: number };
  confidence: number;
  humanRequestCount: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  baseUrl: BASE,

  health: () =>
    request<{ status: string; persistence: string; model: string | null }>(
      "/health",
    ),

  scenarios: () =>
    request<{
      scenarios: Scenario[];
      stats: { orders: number; customers: number };
    }>("/api/catalogue/scenarios"),

  startCall: (language: LanguageCode, channelName?: string) =>
    request<{
      callId: string;
      caseRef: string;
      greeting: string;
      language: LanguageCode;
      channelName: string;
    }>("/api/calls", {
      method: "POST",
      body: JSON.stringify({ language, channelName }),
    }),

  turn: (callId: string, text: string, asrConfidence: number = 1) =>
    request<TurnResponse>(`/api/calls/${callId}/turn`, {
      method: "POST",
      body: JSON.stringify({ text, asrConfidence }),
    }),

  endCall: (callId: string) =>
    request<{ ok: boolean; durationSeconds: number | null; caseRef: string }>(
      `/api/calls/${callId}/end`,
      { method: "POST" },
    ),

  agoraStatus: () =>
    request<{
      enabled: boolean;
      appId: string | null;
      capabilities: {
        voiceRtc: boolean;
        speechToTextSst: boolean;
        conversationalAi: boolean;
        signallingRtm: boolean;
        cloudAgentConfigured?: boolean;
        agentWorkerRunning?: boolean;
      };
      activeSessions?: number;
      system?: any;
    }>("/api/agora/status"),

  getAgoraChannel: (channelName: string, uid = 0) =>
    request<{
      appId: string;
      channelName: string;
      uid: number;
      rtcToken: string;
      rtmToken: string;
      sttToken?: string;
      convoAiToken?: string;
      expiresAt: number;
    }>("/api/agora/channel", {
      method: "POST",
      body: JSON.stringify({ channelName, uid }),
    }),

  publishSignalling: (
    callId: string,
    event: string,
    payload: Record<string, unknown> = {},
  ) =>
    request<{ ok: boolean }>("/api/agora/signalling/publish", {
      method: "POST",
      body: JSON.stringify({ callId, event, payload }),
    }),

  startCloudAgent: (
    channelName: string,
    language: LanguageCode,
    greeting?: string,
    callId?: string,
  ) =>
    request<{
      ok: boolean;
      agentId?: string;
      agentRtcUid?: number;
      message?: string;
      error?: string;
    }>("/api/agora/agent/start", {
      method: "POST",
      body: JSON.stringify({ channelName, language, greeting, callId }),
    }),

  stopCloudAgent: (channelName: string, agentName?: string, callId?: string) =>
    request<{ ok: boolean }>("/api/agora/agent/stop", {
      method: "POST",
      body: JSON.stringify({ channelName, agentName, callId }),
    }),

  subscribeSignalling: (
    callId: string,
    onEvent: (event: any) => void,
  ): (() => void) => {
    try {
      const es = new EventSource(
        `${BASE}/api/agora/signalling/stream?callId=${encodeURIComponent(callId)}`,
      );
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          onEvent(data);
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        // EventSource will auto-reconnect
      };
      return () => es.close();
    } catch {
      return () => {};
    }
  },
};
