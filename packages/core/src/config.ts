import type { FieldKey } from './types.js';

/**
 * Deterministic tuning values.
 *
 * These live in the pure package rather than being read from `process.env` so
 * the logic stays testable without an environment, and so a test can override
 * one threshold without mutating global state. The API layer builds a
 * `PolicyConfig` from env at boot and threads it through.
 */
export interface PolicyConfig {
  /** Score at or above which a value is treated as clearly heard. */
  high: number;
  /** Score below which a value is treated as unreliable. */
  medium: number;
  /** Stricter bars for the two identifiers that must not be guessed. */
  orderIdConfirmation: number;
  identityConfirmation: number;
  /** overall = intentWeight * intent + fieldsWeight * mean(required fields). */
  intentWeight: number;
  fieldsWeight: number;
  /**
   * Times the caller must ask for a human before the call is handed over.
   * Requirement 6.1: "insists multiple time" — the first two asks get a
   * retention attempt instead.
   */
  humanRequestsBeforeHandover: number;
  /**
   * How many times the AI re-asks for a field before it simply carries on with
   * what it has. Note this no longer causes escalation — running out of
   * patience is not a reason to hand over.
   */
  maxFieldAttempts: number;
  /** Orders at or above this value get an elevated case priority. */
  highValueInr: number;
}

export const DEFAULT_POLICY: PolicyConfig = {
  high: 0.85,
  medium: 0.6,
  orderIdConfirmation: 0.85,
  identityConfirmation: 0.85,
  intentWeight: 0.3,
  fieldsWeight: 0.7,
  humanRequestsBeforeHandover: 3,
  maxFieldAttempts: 3,
  highValueInr: 25000,
};

export function withPolicy(overrides: Partial<PolicyConfig> = {}): PolicyConfig {
  const merged = { ...DEFAULT_POLICY, ...overrides };
  assertPolicyValid(merged);
  return merged;
}

export function assertPolicyValid(policy: PolicyConfig): void {
  if (policy.medium >= policy.high) {
    throw new Error(`medium confidence (${policy.medium}) must be below high (${policy.high})`);
  }
  const weightSum = policy.intentWeight + policy.fieldsWeight;
  if (Math.abs(weightSum - 1) > 1e-9) {
    throw new Error(`intentWeight + fieldsWeight must sum to 1, got ${weightSum}`);
  }
  if (policy.humanRequestsBeforeHandover < 1) {
    throw new Error('humanRequestsBeforeHandover must be at least 1');
  }
}

/** Per-field confirmation thresholds, resolved against the active policy. */
export function thresholdFor(field: FieldKey, policy: PolicyConfig): number {
  if (field === 'orderId') return policy.orderIdConfirmation;
  if (field === 'customerIdentity') return policy.identityConfirmation;
  return policy.high;
}
