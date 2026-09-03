import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPolicy, type PolicyConfig } from '@echosphere/core';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env') });

/**
 * Configuration.
 *
 * Loud about what is missing, but only about what is genuinely required. The
 * previous version refused to boot without Agora and Gemini credentials, which
 * made the whole system undemoable on a fresh clone; here the deterministic
 * engine runs regardless and the optional edges degrade with a warning.
 */

function str(key: string, fallback = ''): string {
  return process.env[key]?.trim() ?? fallback;
}

function num(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${key} must be a number, got "${raw}"`);
  return parsed;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1';
}

const NODE_ENV = str('NODE_ENV', 'development');
const IS_PRODUCTION = NODE_ENV === 'production';

/**
 * Session signing key.
 *
 * A generated fallback keeps local development frictionless, at the cost of
 * invalidating sessions on restart. In production a real secret is mandatory,
 * because a per-boot key would silently log everyone out on each deploy.
 */
const AUTH_SECRET = (() => {
  const provided = str('AUTH_SECRET') || str('SESSION_SECRET');
  if (provided && !provided.startsWith('dev-only')) return provided;
  if (IS_PRODUCTION) {
    throw new Error(
      'AUTH_SECRET must be set in production. Generate one with: openssl rand -base64 48',
    );
  }
  console.warn(
    '[config] AUTH_SECRET not set — using an ephemeral development key. Sessions will not survive a restart.',
  );
  return `dev-ephemeral-${Math.random().toString(36).slice(2)}${Date.now()}`;
})();

const DATABASE_URL = str('DATABASE_URL');

const CORS_ORIGINS = str('CORS_ORIGINS', 'http://localhost:3000,http://localhost:5173,http://localhost:5174')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export const config = {
  NODE_ENV,
  IS_PRODUCTION,
  PORT: num('PORT', 3001),
  DATABASE_URL,
  CORS_ORIGINS,
  AUTH_SECRET,
  SESSION_TTL_DAYS: num('SESSION_TTL_DAYS', 30),

  gemini: {
    apiKey: str('GEMINI_API_KEY'),
    model: str('GEMINI_MODEL', 'gemini-3.7-flash'),
    enabled: Boolean(str('GEMINI_API_KEY')),
  },

  agora: {
    appId: str('AGORA_APP_ID'),
    appCertificate: str('AGORA_APP_CERTIFICATE'),
    customerId: str('AGORA_CUSTOMER_ID'),
    customerSecret: str('AGORA_CUSTOMER_SECRET'),
    tokenTtlSeconds: num('AGORA_RTC_TOKEN_TTL', 3600),
    agentId: str('AGORA_AGENT_ID', '9d9ba5ddc6f6448e8bfc1881f13f777c'),
    enabled: Boolean(str('AGORA_APP_ID') && str('AGORA_APP_CERTIFICATE')),
    cloudAgentEnabled: Boolean(str('AGORA_CUSTOMER_ID') && str('AGORA_CUSTOMER_SECRET')),
  },

  /** Seed a first admin so a fresh install is usable. Disable in production. */
  seedAdmin: {
    enabled: bool('SEED_ADMIN', !IS_PRODUCTION),
    email: str('SEED_ADMIN_EMAIL', 'admin@nerv.dev'),
    password: str('SEED_ADMIN_PASSWORD', 'echosphere123'),
    name: str('SEED_ADMIN_NAME', 'Ops Admin'),
  },
} as const;

export const policy: PolicyConfig = withPolicy({
  high: num('CONFIDENCE_HIGH', 0.85),
  medium: num('CONFIDENCE_MEDIUM', 0.6),
  orderIdConfirmation: num('ORDER_ID_CONFIRMATION_THRESHOLD', 0.85),
  identityConfirmation: num('IDENTITY_CONFIRMATION_THRESHOLD', 0.85),
  intentWeight: num('CONFIDENCE_INTENT_WEIGHT', 0.3),
  fieldsWeight: num('CONFIDENCE_FIELDS_WEIGHT', 0.7),
  humanRequestsBeforeHandover: num('HUMAN_REQUESTS_BEFORE_HANDOVER', 3),
  maxFieldAttempts: num('MAX_FIELD_ATTEMPTS', 3),
  highValueInr: num('HIGH_VALUE_INR', 25000),
});

/** Printed once at boot so a misconfigured deploy is obvious from the logs. */
export function describeConfig(): string[] {
  const lines: string[] = [];
  lines.push(`environment      ${config.NODE_ENV}`);
  lines.push(
    `database         ${config.DATABASE_URL ? 'Neon Postgres' : 'in-memory (set DATABASE_URL to persist)'}`,
  );
  lines.push(
    `language model   ${config.gemini.enabled ? `Gemini (${config.gemini.model})` : 'DISABLED — replies fall back to templates'}`,
  );
  if (!config.gemini.enabled) {
    lines.push('WARNING: Gemini API key not set — AI responses will use templates only');
  }
  lines.push(`agora rtc        ${config.agora.enabled ? 'enabled' : 'disabled'}`);
  lines.push(`escalate after   ${policy.humanRequestsBeforeHandover} requests for a human`);
  return lines;
}
