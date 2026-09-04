import { thresholdFor, type PolicyConfig } from "./config.js";
import { FIELD_DEFINITIONS, requiredFieldsFor } from "./fields.js";
import type {
  ConfidenceLevel,
  ConversationState,
  FieldKey,
  IntentKey,
} from "./types.js";

/**
 * Confidence engine.
 *
 * A model's self-reported confidence is treated as one noisy input, never as
 * truth. Every decision that depends on confidence goes through a threshold
 * defined in `config.ts`, so behaviour is reproducible and auditable rather than
 * a property of a given prompt.
 *
 * Note what confidence no longer does: it does not escalate. Low confidence
 * means ask again or read back — handing the call to a human because the audio
 * was poor was one of the six triggers that made the old system escalate on
 * ordinary friction.
 */

export function levelOf(score: number, policy: PolicyConfig): ConfidenceLevel {
  if (score >= policy.high) return "HIGH";
  if (score >= policy.medium) return "MEDIUM";
  return "LOW";
}

/**
 * Confidence that a heard value is correct. ASR and extraction confidence are
 * multiplied rather than averaged: a value is only as trustworthy as its
 * weakest link, and averaging lets a confident extractor mask bad audio.
 */
export function combineAsrAndExtraction(
  asrConfidence: number,
  extractionConfidence: number,
): number {
  return clamp01(clamp01(asrConfidence) * clamp01(extractionConfidence));
}

export function meetsThreshold(
  field: FieldKey,
  score: number,
  policy: PolicyConfig,
): boolean {
  return score >= thresholdFor(field, policy);
}

/**
 * Aggregate confidence for the conversation: 30% intent, 70% the mean
 * confidence of the fields this intent requires. Fields never heard count as
 * zero, so an unanswered P0 question visibly drags the total down instead of
 * being quietly omitted from the average.
 */
export function overallConfidence(
  state: ConversationState,
  policy: PolicyConfig,
): number {
  const required = requiredFieldsFor(state.intent.value);
  if (required.length === 0) return clamp01(state.intent.confidence);

  const total = required.reduce(
    (sum, field) =>
      sum + clamp01(state.requiredInformation[field]?.confidence ?? 0),
    0,
  );

  const fieldsMean = total / required.length;
  return round2(
    clamp01(
      policy.intentWeight * clamp01(state.intent.confidence) +
        policy.fieldsWeight * fieldsMean,
    ),
  );
}

/** Fields this intent requires that are not yet confirmed. */
export function unconfirmedRequiredFields(
  state: ConversationState,
): FieldKey[] {
  return requiredFieldsFor(state.intent.value).filter(
    (field) => state.requiredInformation[field]?.confirmed !== true,
  );
}

/** Critical fields this intent requires that are not yet confirmed. */
export function unconfirmedCriticalFields(
  state: ConversationState,
): FieldKey[] {
  return unconfirmedRequiredFields(state).filter(
    (field) => FIELD_DEFINITIONS[field].critical,
  );
}

export function isIntentReliable(
  intent: IntentKey,
  confidence: number,
  policy: PolicyConfig,
): boolean {
  return intent !== "unknown" && confidence >= policy.medium;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
