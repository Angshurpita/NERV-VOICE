import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withPolicy, type PolicyConfig } from "@echosphere/core";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../.env") });

/**
 * Configuration.
 *
 * Loud about what is missing, but only about what is genuinely required. The
 * previous version refused to boot without Agora and Gemini credentials, which
 * made the whole system undemoable on a fresh clone; here the deterministic
 * engine runs regardless and the optional edges degrade with a warning.
 */

function str(key: string, fallback = ""): string {
  return process.env[key]?.trim() ?? fallback;
}

function num(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed))
    throw new Error(`${key} must be a number, got "${raw}"`);
  return parsed;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "true" || raw === "1";
}

const NODE_ENV = str("NODE_ENV", "development");
const IS_PRODUCTION = NODE_ENV === "production";

/**
 * Session signing key.
 *
 * A generated fallback keeps local development frictionless, at the cost of
 * invalidating sessions on restart. In production a real secret is mandatory,
 * because a per-boot key would silently log everyone out on each deploy.
 */
const AUTH_SECRET = (() => {
  const provided = str("AUTH_SECRET") || str("SESSION_SECRET");
  if (provided && !provided.startsWith("dev-only")) return provided;
  if (IS_PRODUCTION) {
    throw new Error(
      "AUTH_SECRET must be set in production. Generate one with: openssl rand -base64 48",
    );
  }
  console.warn(
    "[config] AUTH_SECRET not set — using an ephemeral development key. Sessions will not survive a restart.",
  );
  return `dev-ephemeral-${Math.random().toString(36).slice(2)}${Date.now()}`;
})();

const DATABASE_URL = str("DATABASE_URL");

const CORS_ORIGINS = str(
  "CORS_ORIGINS",
  "http://localhost:3000,http://localhost:5173,http://localhost:5174",
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const RAW_PUBLIC_URL =
  str("PUBLIC_URL") || str("VERCEL_URL") || str("BACKEND_URL");
const RAW_AGORA_LLM_URL = str("AGORA_LLM_URL");

/**
 * Resolves the authoritative CustomLLM endpoint URL for Agora Conversational AI Agent.
 *
 * Expected behavior:
 * - If AGORA_LLM_URL exists: use it exactly as supplied.
 * - If AGORA_LLM_URL does not exist but PUBLIC_URL exists:
 *   construct `${PUBLIC_URL}/api/agora/openai/v1/chat/completions`
 *   Normalizing trailing slashes so this does not produce `//api/agora/...`
 */
export function resolveAgoraLlmUrl(
  rawLlmUrl?: string,
  rawPublicUrl?: string,
): string {
  const llmUrl = rawLlmUrl?.trim();
  if (llmUrl) {
    return llmUrl;
  }
  const publicUrl = rawPublicUrl?.trim();
  if (publicUrl) {
    const stripped = publicUrl.replace(/\/+$/, "");
    const normalized =
      stripped.startsWith("http://") || stripped.startsWith("https://")
        ? stripped
        : `https://${stripped}`;
    return `${normalized}/api/agora/openai/v1/chat/completions`;
  }
  return "";
}

/**
 * Checks if a URL points to localhost, loopback, or private/internal networks
 * that are unreachable from Agora's cloud service in production.
 */
export function isPrivateOrLocalhostUrl(urlString: string): boolean {
  if (!urlString) return false;
  try {
    const parsed = new URL(urlString);
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    ) {
      return true;
    }
    const parts = host.split(".").map(Number);
    if (
      parts.length === 4 &&
      parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)
    ) {
      if (parts[0] === 10) return true;
      if (parts[0] === 127) return true;
      if (parts[0] === 0) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 169 && parts[1] === 254) return true;
    }
    return false;
  } catch {
    return false;
  }
}

const formattedPublicUrl = RAW_PUBLIC_URL
  ? RAW_PUBLIC_URL.startsWith("http")
    ? RAW_PUBLIC_URL.replace(/\/+$/, "")
    : `https://${RAW_PUBLIC_URL.replace(/\/+$/, "")}`
  : "";

const resolvedLlmUrl = resolveAgoraLlmUrl(RAW_AGORA_LLM_URL, RAW_PUBLIC_URL);

export const config = {
  NODE_ENV,
  IS_PRODUCTION,
  PORT: num("PORT", 3001),
  DATABASE_URL,
  CORS_ORIGINS,
  AUTH_SECRET,
  SESSION_TTL_DAYS: num("SESSION_TTL_DAYS", 30),
  PUBLIC_URL: formattedPublicUrl,

  gemini: {
    apiKey: str("GEMINI_API_KEY"),
    model: str("GEMINI_MODEL", "gemini-3.8-flash"),
    enabled: Boolean(str("GEMINI_API_KEY")),
  },

  deepgram: {
    apiKey: str("DEEPGRAM_API_KEY"),
    ttsModel: str("DEEPGRAM_TTS_MODEL", "aura-2-thalia-en"),
    sttModel: str("DEEPGRAM_STT_MODEL", "nova-3"),
    sttHindiModel: str("DEEPGRAM_STT_HINDI_MODEL", "nova-2"),
  },

  agora: {
    appId: str("AGORA_APP_ID"),
    appCertificate: str("AGORA_APP_CERTIFICATE"),
    customerId: str("AGORA_CUSTOMER_ID"),
    customerSecret: str("AGORA_CUSTOMER_SECRET"),
    tokenTtlSeconds: num("AGORA_RTC_TOKEN_TTL", 3600),
    hasCredentials: Boolean(
      str("AGORA_APP_ID") && str("AGORA_APP_CERTIFICATE"),
    ),
    hasCustomerCredentials: Boolean(
      str("AGORA_CUSTOMER_ID") && str("AGORA_CUSTOMER_SECRET"),
    ),
    enabled: Boolean(str("AGORA_APP_ID") && str("AGORA_APP_CERTIFICATE")),
    cloudAgentEnabled: Boolean(
      str("AGORA_APP_ID") &&
      str("AGORA_APP_CERTIFICATE") &&
      str("AGORA_CUSTOMER_ID") &&
      str("AGORA_CUSTOMER_SECRET"),
    ),
    llmUrl: resolvedLlmUrl,
  },

  /** Seed a first admin so a fresh install is usable. Disable in production. */
  seedAdmin: {
    enabled: bool("SEED_ADMIN", !IS_PRODUCTION),
    email: str("SEED_ADMIN_EMAIL", "admin@nerv.dev"),
    password: str("SEED_ADMIN_PASSWORD", "echosphere123"),
    name: str("SEED_ADMIN_NAME", "Ops Admin"),
  },
} as const;

// Production requirement: fail loudly if Agora Cloud Agent is enabled without a public CustomLLM endpoint
if (config.IS_PRODUCTION && config.agora.cloudAgentEnabled) {
  if (!config.agora.llmUrl) {
    throw new Error(
      "CRITICAL CONFIGURATION ERROR: PUBLIC_URL or AGORA_LLM_URL must be configured in production for Agora Conversational AI Agent CustomLLM callbacks. Agora servers cannot reach an unconfigured endpoint.",
    );
  }
  if (isPrivateOrLocalhostUrl(config.agora.llmUrl)) {
    throw new Error(
      `CRITICAL CONFIGURATION ERROR: Agora CustomLLM URL "${config.agora.llmUrl}" points to localhost or a private IP. Agora cloud service cannot reach private/local addresses in production. Configure a public HTTPS URL (e.g. via Cloudflare tunnel, ngrok, or production domain).`,
    );
  }
}

export const policy: PolicyConfig = withPolicy({
  high: num("CONFIDENCE_HIGH", 0.85),
  medium: num("CONFIDENCE_MEDIUM", 0.6),
  orderIdConfirmation: num("ORDER_ID_CONFIRMATION_THRESHOLD", 0.85),
  identityConfirmation: num("IDENTITY_CONFIRMATION_THRESHOLD", 0.85),
  intentWeight: num("CONFIDENCE_INTENT_WEIGHT", 0.3),
  fieldsWeight: num("CONFIDENCE_FIELDS_WEIGHT", 0.7),
  humanRequestsBeforeHandover: num("HUMAN_REQUESTS_BEFORE_HANDOVER", 3),
  maxFieldAttempts: num("MAX_FIELD_ATTEMPTS", 3),
  highValueInr: num("HIGH_VALUE_INR", 25000),
});

/** Printed once at boot so a misconfigured deploy is obvious from the logs. */
export function describeConfig(): string[] {
  const lines: string[] = [];
  lines.push(`environment      ${config.NODE_ENV}`);
  lines.push(
    `database         ${config.DATABASE_URL ? "Neon Postgres" : "in-memory (set DATABASE_URL to persist)"}`,
  );
  lines.push(
    `reasoning engine ${config.gemini.enabled ? `Gemini (${config.gemini.model})` : "DISABLED — replies fall back to deterministic templates"}`,
  );
  if (!config.gemini.enabled) {
    lines.push(
      "WARNING: Gemini API key not set — AI responses will use deterministic templates only",
    );
  }
  lines.push(
    `agora rtc        ${config.agora.enabled ? "enabled" : "disabled"}`,
  );
  lines.push(
    `agora cloud agt  ${config.agora.cloudAgentEnabled ? "enabled" : "disabled"}`,
  );
  lines.push(`speech to text   Deepgram (${config.deepgram.sttModel})`);
  lines.push(`text to speech   Deepgram Aura (${config.deepgram.ttsModel})`);
  lines.push(
    `llm bridge url   ${config.agora.llmUrl || "NOT CONFIGURED (set PUBLIC_URL or AGORA_LLM_URL)"}`,
  );
  lines.push(
    `escalate after   ${policy.humanRequestsBeforeHandover} requests for a human`,
  );
  return lines;
}

/** Detailed health status distinguishing credentials, agents, model, and db. */
export function getSystemStatus() {
  return {
    environment: config.NODE_ENV,
    isProduction: config.IS_PRODUCTION,
    agora: {
      hasCredentials: config.agora.hasCredentials,
      hasCustomerCredentials: config.agora.hasCustomerCredentials,
      voiceRtc: config.agora.hasCredentials,
      cloudAgent: config.agora.cloudAgentEnabled,
      speechToTextSst: config.agora.hasCredentials,
      conversationalAi: config.agora.cloudAgentEnabled,
      signallingRtm: config.agora.hasCredentials,
      appId: config.agora.appId ? `${config.agora.appId.slice(0, 6)}...` : null,
      llmBridgeConfigured: Boolean(config.agora.llmUrl),
      llmBridgeUrl: config.agora.llmUrl || null,
      sttConfigured: true,
      sttProvider: "deepgram",
      sttModel: config.deepgram.sttModel,
      ttsConfigured: true,
      ttsProvider: "deepgram_aura",
      ttsModel: config.deepgram.ttsModel,
    },
    brain: {
      model: config.gemini.model,
      enabled: config.gemini.enabled,
    },
    database: {
      kind: config.DATABASE_URL ? ("postgres" as const) : ("memory" as const),
      persistent: Boolean(config.DATABASE_URL),
    },
    ticketing: {
      enabled: true,
      escalateAfter: policy.humanRequestsBeforeHandover,
    },
  };
}
