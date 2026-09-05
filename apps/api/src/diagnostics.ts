/**
 * Structured Voice Pipeline Diagnostics.
 *
 * Implements authoritative observability across the Agora Conversational AI,
 * Agora Ares ASR, EchoSphere turn decision engine, and OpenAI TTS pipeline.
 */

export type VoiceDiagnosticEvent =
  | "CALL_CREATED"
  | "AGORA_TOKEN_CREATED"
  | "CUSTOM_LLM_URL_RESOLVED"
  | "AGORA_AGENT_START_REQUESTED"
  | "AGORA_AGENT_STARTED"
  | "AGORA_AGENT_JOINED"
  | "CUSTOM_LLM_REQUEST_RECEIVED"
  | "STT_UTTERANCE_RECEIVED"
  | "ECHOSPHERE_TURN_STARTED"
  | "ECHOSPHERE_TURN_COMPLETED"
  | "CUSTOM_LLM_RESPONSE_SENT"
  | "TTS_RESPONSE_STARTED"
  | "AGENT_AUDIO_PUBLISHED"
  | "AGENT_STOPPED"
  | "CALL_ENDED"
  | "CALL_TRANSFERRED"
  | "PIPELINE_ERROR";

export interface DiagnosticContext {
  callId?: string | null;
  channelName?: string | null;
  agentId?: string | null;
  [key: string]: unknown;
}

export function logVoiceDiagnostic(
  event: VoiceDiagnosticEvent,
  context: DiagnosticContext = {},
): void {
  const timestamp = new Date().toISOString();
  const { callId, channelName, agentId, ...rest } = context;

  // Ensure no sensitive credentials or keys can ever be logged
  const safePayload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    const lower = k.toLowerCase();
    if (
      lower.includes("secret") ||
      lower.includes("key") ||
      lower.includes("cert") ||
      lower.includes("password") ||
      lower.includes("token")
    ) {
      safePayload[k] = "[REDACTED]";
    } else {
      safePayload[k] = v;
    }
  }

  const output = {
    timestamp,
    event,
    callId: callId ?? null,
    channelName: channelName ?? null,
    agentId: agentId ?? null,
    ...safePayload,
  };

  const prefix = `[VOICE_DIAGNOSTIC][${event}]`;
  const meta = `callId=${callId || "none"} channel=${channelName || "none"} agentId=${agentId || "none"}`;
  console.log(
    `${prefix} ${meta}`,
    Object.keys(safePayload).length > 0 ? safePayload : "",
  );
}
