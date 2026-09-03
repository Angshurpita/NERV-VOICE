import type { PolicyConfig } from './config.js';
import { combineAsrAndExtraction } from './confidence.js';
import {
  advanceTurn,
  applyConfirmation,
  createState,
  noteExecutedAction,
  noteHumanRequest,
  nextQuestion,
  observeField,
  observeLanguage,
  recomputeConfidence,
  requestConfirmation,
  systemClock,
  type Clock,
} from './conversation-state.js';
import { applyEscalation, evaluateEscalation, type EscalationDecision } from './escalation.js';
import { reasonFieldFor } from './fields.js';
import { evaluateCancellation } from './order-policy.js';
import { planRetention, type RetentionPlan } from './persuasion.js';
import {
  buildTurnPrompt,
  composeInstruction,
  humanise,
  SYSTEM_PROMPT,
  type ModelTurnOutput,
} from './prompt.js';
import { classifyRequest, safeFallback, screenResponse } from './safety.js';
import {
  detectAgreement,
  detectHumanRequest,
  detectIntentHints,
  detectLanguage,
  extractOrderIdCandidates,
  extractPersonName,
  extractReason,
} from './signals.js';
import {
  applyLookup,
  applyNameCheck,
  applyOrderConfirmation,
  describeOrder,
  markReadBack,
  planVerification,
} from './verification.js';
import type {
  ConversationEvent,
  ConversationState,
  IntentKey,
  LanguageCode,
  Order,
  OrderLookupResult,
} from './types.js';

/**
 * The turn pipeline.
 *
 * One caller utterance in, one spoken reply out. This is deliberately a single
 * pure-ish function with injected I/O rather than a chain of services, because
 * the ordering *is* the product: which check runs before which is what decides
 * whether the AI verifies before acting (req 7) and persuades before handing
 * over (req 6).
 *
 * Shape of a turn:
 *   1. Deterministic reading of the utterance — language, signals, entities.
 *   2. Order lookup, if there is now something to look up.
 *   3. Policy: verification gate → retention ladder → escalation.
 *   4. One model call, whose only job is phrasing the instruction policy chose.
 *   5. Re-check escalation against what the model heard, then screen and clean.
 *
 * The model is called exactly once. It never decides step 3.
 */

export interface TurnDeps {
  policy: PolicyConfig;
  lookupOrder(orderId: string): Promise<OrderLookupResult>;
  /** Draft a reply. Implementations must not mutate state. */
  callModel(input: { system: string; prompt: string }): Promise<ModelTurnOutput>;
  /** Perform a cancellation the AI is permitted to make. */
  cancelOrder?(orderId: string): Promise<boolean>;
  clock?: Clock;
}

export interface TurnResult {
  state: ConversationState;
  /** Cleaned, ready to hand to speech synthesis. */
  reply: string;
  language: LanguageCode;
  escalated: boolean;
  escalation: EscalationDecision | null;
  /** The order in hand this turn, if verified. */
  order: Order | null;
  events: ConversationEvent[];
}

export interface TurnInput {
  state: ConversationState;
  utterance: string;
  /** ASR confidence for this utterance, 0..1. Defaults to 1 for typed input. */
  asrConfidence?: number;
  history: Array<{ speaker: 'caller' | 'agent'; text: string }>;
}

export async function runTurn(input: TurnInput, deps: TurnDeps): Promise<TurnResult> {
  const clock = deps.clock ?? systemClock;
  const { policy } = deps;
  const asr = clamp01(input.asrConfidence ?? 1);
  const utterance = input.utterance.trim();
  const events: ConversationEvent[] = [];
  const emit = (type: ConversationEvent['type'], payload: unknown) =>
    events.push({ type, sessionId: input.state.sessionId, at: clock.now().toISOString(), payload });

  let state = advanceTurn(input.state, clock);

  // ── 1. Read the utterance deterministically ───────────────────────────────

  const language = detectLanguage(utterance, state.language.primary);
  if (language !== state.language.primary) {
    state = observeLanguage(state, language, clock);
    emit('LANGUAGE_CHANGED', { to: language });
  }

  const safety = classifyRequest(utterance);
  if (!safety.allowed) emit('SAFETY_BLOCKED', { domain: safety.domain });

  const humanSignal = detectHumanRequest(utterance);
  if (humanSignal.requested) {
    state = noteHumanRequest(state, humanSignal.refusesAiHelp, clock);
    emit('RETENTION_ATTEMPTED', { count: state.humanRequestCount });
  }

  const hints = detectIntentHints(utterance);
  state = applyProvisionalIntent(state, hints, policy, clock);

  // Answers to an outstanding read-back are applied before anything new is
  // heard, so "no, 4852" both rejects the old value and records the new one.
  const agreement = detectAgreement(utterance);
  state = applyPendingAnswers(state, agreement, clock, emit);

  // Entities. Regex extraction runs first so a settled order id is available
  // this turn rather than next; the model's reading is folded in later.
  for (const candidate of extractOrderIdCandidates(utterance)) {
    state = observeField(state, 'orderId', candidate, combineAsrAndExtraction(asr, 0.95), utterance, clock);
    emit('ENTITY_DETECTED', { field: 'orderId', value: candidate });
  }

  /**
   * Names and reasons, deterministically.
   *
   * These used to come only from the model, which meant the requirement-7
   * identity check could not complete at all when the model was unavailable or
   * simply failed to populate the field — the call would loop on "whose name is
   * this under?" forever. Extraction here keeps the gate working on its own; the
   * model's reading is still merged in afterwards and wins when it is more
   * confident.
   */
  const expectingName = isAwaitingName(state);
  const heardName = extractPersonName(utterance, expectingName);
  if (heardName) {
    state = observeField(
      state,
      'customerIdentity',
      heardName,
      combineAsrAndExtraction(asr, expectingName ? 0.92 : 0.85),
      utterance,
      clock,
    );
    emit('ENTITY_DETECTED', { field: 'customerIdentity', value: heardName });
  }

  const reasonField = reasonFieldFor(state.intent.value);
  if (reasonField && !state.requiredInformation[reasonField]?.confirmed) {
    const heardReason = extractReason(utterance);
    if (heardReason) {
      state = observeField(state, reasonField, heardReason, combineAsrAndExtraction(asr, 0.9), utterance, clock);
      emit('ENTITY_DETECTED', { field: reasonField, value: heardReason });
    }
  }

  // ── 2. Look the order up, once there is a single settled id ───────────────

  let lookup: OrderLookupResult | null = null;
  const settledOrderId = state.requiredInformation.orderId?.value ?? null;
  if (settledOrderId && !state.verification.lookedUp) {
    lookup = await deps.lookupOrder(settledOrderId);
    state = applyLookup(state, lookup, clock);
    emit(lookup.outcome === 'found' ? 'ORDER_VERIFIED' : 'ORDER_VERIFICATION_FAILED', {
      orderId: settledOrderId,
      outcome: lookup.outcome,
    });
  }

  /**
   * The order in hand this turn.
   *
   * Re-fetched when it was verified on an earlier turn: `verification` persists
   * across turns but the `Order` itself is not stored on the state, so without
   * this every turn after the read-back saw `order === null` — which silently
   * disabled the cancellation rules and the resolution path, because both are
   * guarded on having an order. The lookup is served from the in-memory
   * catalogue, so re-reading it per turn costs nothing.
   */
  let order: Order | null = lookup?.outcome === 'found' ? lookup.order : null;
  if (!order && state.verification.lookupOutcome === 'found') {
    const orderId = state.verification.orderId ?? settledOrderId;
    if (orderId) {
      const again = await deps.lookupOrder(orderId);
      if (again.outcome === 'found') order = again.order;
    }
  }

  // Name check, once both the order and a claimed name exist.
  const claimedName = state.requiredInformation.customerIdentity?.value;
  if (claimedName && state.verification.ordererName && state.verification.nameMatches === null) {
    state = applyNameCheck(state, claimedName, state.verification.ordererName, clock);
  }

  // ── 3. Policy ─────────────────────────────────────────────────────────────

  state = recomputeConfidence(state, policy, clock);

  let verification = planVerification(state, policy, order);
  let retention: RetentionPlan | null = humanSignal.requested || state.humanRequestCount > 0
    ? planRetention(state, policy, order)
    : null;

  let decision = evaluateEscalation(
    state,
    policy,
    order,
    { safetyEscalation: safety.requiresEscalation, hints },
    clock.now(),
  );

  // A resolution the AI is allowed to perform itself. Requirement 6 means most
  // calls end here rather than with a human.
  let resolution: string | null = null;
  if (!decision.required && verification.canProceed && order) {
    const outcome = await attemptResolution(state, order, hints, deps, clock);
    state = outcome.state;
    resolution = outcome.instruction;
    if (outcome.executed) emit('TOOL_EXECUTED', { action: outcome.executed });
  }

  // Mark the read-back as delivered so the next turn awaits a yes/no rather
  // than reading the same details out again.
  if (verification.step === 'READ_BACK_REQUIRED') {
    state = markReadBack(state, clock);
  }

  /**
   * The next field question — only once the verification gate has cleared.
   *
   * While the gate is still asking for an order number or a read-back,
   * `composeInstruction` ignores this question anyway; computing it would still
   * set `pendingConfirmation`, and a later "yes" would then be spent confirming
   * a field instead of the order read-back it was meant for.
   */
  let question =
    decision.required || !verification.canProceed ? null : nextQuestion(state, policy);
  if (question?.kind === 'confirm' && state.pendingConfirmation !== question.field) {
    state = requestConfirmation(state, question.field, clock);
    emit('QUESTION_ASKED', { field: question.field, kind: question.kind });
  }

  // ── 4. One model call, for phrasing only ──────────────────────────────────

  const instruction = composeInstruction({
    verification,
    retention,
    question,
    escalating: decision.required,
    resolution,
  });

  let model: ModelTurnOutput | null = null;
  try {
    model = await deps.callModel({
      system: SYSTEM_PROMPT,
      prompt: buildTurnPrompt({
        state,
        history: input.history.slice(-10),
        utterance,
        order,
        instruction,
        safetyGuidance: safety.responseGuidance,
        language,
      }),
    });
  } catch {
    // A model outage must not drop the call. Policy already decided what this
    // turn is for, so a template can carry it.
    model = null;
  }

  // ── 5. Fold in what the model heard, then re-check ────────────────────────

  if (model) {
    state = applyModelReading(state, model, asr, utterance, policy, clock, emit);

    // The model may have caught a request for a human that the patterns missed
    // ("I'd rather not do this with a computer"). Count it, then re-evaluate.
    if (model.wantsHuman && !humanSignal.requested) {
      state = noteHumanRequest(state, false, clock);
      retention = planRetention(state, policy, order);
    }

    const recheck = evaluateEscalation(
      state,
      policy,
      order,
      { safetyEscalation: safety.requiresEscalation, hints: mergeHints(hints, model.intent) },
      clock.now(),
    );
    if (recheck.required && !decision.required) {
      // Policy changed under us because the model understood the intent better
      // than the patterns did. Hand over with a template rather than trusting a
      // reply that was drafted for a different purpose.
      decision = recheck;
      verification = planVerification(state, policy, order);
      question = null;
    }
  }

  if (decision.required) {
    state = applyEscalation(state, decision, clock.now());
    emit('ESCALATION_TRIGGERED', { reason: decision.reason, detail: decision.detail });
  }

  // Draft → screened → cleaned.
  let reply = model?.reply?.trim() || fallbackReply(decision, verification.guidance, language);

  if (decision.required && !model) {
    reply = handoverLine(language);
  }

  const screen = screenResponse(reply, state, state.phase === 'human_active');
  if (!screen.ok) {
    emit('RESPONSE_REWRITTEN', { violations: screen.violations });
    reply = decision.required ? handoverLine(language) : safeFallback(language);
  }

  return {
    state,
    reply: humanise(reply, language),
    language,
    escalated: decision.required,
    escalation: decision.required ? decision : null,
    order,
    events,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Set a provisional intent from the caller's own words.
 *
 * Runs before the model call so that requirements 6.2/6.3 are evaluated on this
 * turn rather than one turn late. Lexical hints are narrow but high-precision:
 * someone who says "refund" wants a refund.
 */
function applyProvisionalIntent(
  state: ConversationState,
  hints: { cancel: boolean; return_: boolean; refund: boolean },
  policy: PolicyConfig,
  clock: Clock,
): ConversationState {
  const provisional: IntentKey | null = hints.refund
    ? 'refund_request'
    : hints.return_
      ? 'return_request'
      : hints.cancel
        ? 'cancellation_request'
        : null;

  if (!provisional || state.intent.value === provisional) return state;

  // Do not downgrade a confidently classified intent on a passing mention.
  if (state.intent.value !== 'unknown' && state.intent.confidence >= policy.high) return state;

  return recomputeConfidence(
    { ...state, intent: { value: provisional, confidence: Math.max(state.intent.confidence, 0.7) } },
    policy,
    clock,
  );
}

/** Apply a yes/no to whatever is currently awaiting one. */
function applyPendingAnswers(
  state: ConversationState,
  agreement: 'yes' | 'no' | 'unclear',
  clock: Clock,
  emit: (type: ConversationEvent['type'], payload: unknown) => void,
): ConversationState {
  if (agreement === 'unclear') return state;

  // The order read-back takes precedence: it is the gate everything else waits
  // behind, so an ambiguous "yes" must not be spent on a lesser field.
  if (state.verification.readBack && !state.verification.confirmed) {
    emit(agreement === 'yes' ? 'ENTITY_CONFIRMED' : 'ORDER_VERIFICATION_FAILED', {
      field: 'order',
      accepted: agreement === 'yes',
    });
    return applyOrderConfirmation(state, agreement === 'yes', clock);
  }

  if (state.pendingConfirmation) {
    const field = state.pendingConfirmation;
    emit('ENTITY_CONFIRMED', { field, accepted: agreement === 'yes' });
    return applyConfirmation(state, field, agreement === 'yes', undefined, clock);
  }

  return state;
}

/** Record entities and intent the model reported. */
function applyModelReading(
  state: ConversationState,
  model: ModelTurnOutput,
  asr: number,
  utterance: string,
  policy: PolicyConfig,
  clock: Clock,
  emit: (type: ConversationEvent['type'], payload: unknown) => void,
): ConversationState {
  let next = state;

  if (isIntentKey(model.intent)) {
    const confidence = clamp01(model.intentConfidence);
    if (confidence >= next.intent.confidence || next.intent.value === 'unknown') {
      next = recomputeConfidence(
        { ...next, intent: { value: model.intent, confidence } },
        policy,
        clock,
      );
    }
  }

  const heard = model.heard ?? {};

  if (heard.orderId) {
    next = observeField(
      next,
      'orderId',
      heard.orderId,
      combineAsrAndExtraction(asr, clamp01(heard.orderIdConfidence ?? 0.8)),
      utterance,
      clock,
    );
  }

  if (heard.customerName) {
    next = observeField(
      next,
      'customerIdentity',
      heard.customerName,
      combineAsrAndExtraction(asr, clamp01(heard.customerNameConfidence ?? 0.8)),
      utterance,
      clock,
    );
    emit('ENTITY_DETECTED', { field: 'customerIdentity', value: heard.customerName });
  }

  if (heard.reason) {
    const field = reasonFieldFor(next.intent.value);
    if (field) {
      next = observeField(next, field, heard.reason, combineAsrAndExtraction(asr, 0.9), utterance, clock);
    }
  }

  return recomputeConfidence(next, policy, clock);
}

/**
 * Do the thing the caller asked for, when the AI is allowed to.
 *
 * This is the counterweight to requirement 6: escalating rarely is only an
 * improvement if the AI actually resolves what it keeps. A cancellation before
 * dispatch happens here, in full, with no human involved.
 */
async function attemptResolution(
  state: ConversationState,
  order: Order,
  hints: { cancel: boolean; return_: boolean; refund: boolean },
  deps: TurnDeps,
  clock: Clock,
): Promise<{ state: ConversationState; instruction: string | null; executed: string | null }> {
  const wantsCancel = state.intent.value === 'cancellation_request' || hints.cancel;
  if (!wantsCancel) return { state, instruction: null, executed: null };

  const reason = state.requiredInformation.cancellationReason;
  if (!reason || reason.candidates.length === 0) {
    return {
      state,
      instruction:
        'Before cancelling, ask briefly why they want to cancel — one short question, not an ' +
        'interrogation. Make clear you can do it for them.',
      executed: null,
    };
  }

  const verdict = evaluateCancellation(order, deps.policy);

  if (verdict.outcome === 'not_possible') {
    return {
      state,
      instruction: `Explain plainly, in one sentence: ${verdict.reason} Then ask what else you can do.`,
      executed: null,
    };
  }

  if (verdict.outcome === 'ai_may_cancel' && deps.cancelOrder) {
    const done = await deps.cancelOrder(order.id);
    if (done) {
      return {
        state: noteExecutedAction(state, 'cancel_order', clock),
        instruction:
          `You have just cancelled ${describeOrder(order)} — it is done, so say so plainly and ` +
          `confidently. Mention that any payment made comes back to the original payment method ` +
          `in five to seven working days. Do not offer to transfer them anywhere.`,
        executed: 'cancel_order',
      };
    }
    return {
      state,
      instruction:
        'The cancellation attempt failed. Say honestly that it did not go through and that you are ' +
        'getting a colleague to finish it. Do not claim it is cancelled.',
      executed: null,
    };
  }

  return { state, instruction: null, executed: null };
}

function mergeHints(
  hints: { cancel: boolean; return_: boolean; refund: boolean },
  modelIntent: string,
): { cancel: boolean; return_: boolean; refund: boolean } {
  return {
    cancel: hints.cancel || modelIntent === 'cancellation_request',
    return_: hints.return_ || modelIntent === 'return_request',
    refund: hints.refund || modelIntent === 'refund_request',
  };
}

/**
 * Whether the previous turn asked for the caller's name.
 *
 * Gates the bare-name fallback in `extractPersonName`, so "Rahul Sharma" is read
 * as an answer only when a name was actually the question.
 */
function isAwaitingName(state: ConversationState): boolean {
  if (state.pendingConfirmation === 'customerIdentity') return true;
  const identity = state.requiredInformation.customerIdentity;
  if (identity?.confirmed) return false;
  // The order has been found but no name heard yet — that is exactly the point in
  // the sequence where the gate asks for one.
  return state.verification.lookupOutcome === 'found' && !identity?.value;
}

function fallbackReply(
  decision: EscalationDecision,
  guidance: string,
  language: LanguageCode,
): string {
  if (decision.required) return handoverLine(language);
  void guidance;
  return language === 'hi'
    ? 'माफ़ कीजिए, ज़रा दोबारा बताइए?'
    : "Sorry, could you say that once more?";
}

function handoverLine(language: LanguageCode): string {
  return language === 'hi'
    ? 'ठीक है, मैं आपको अपने कलीग से जोड़ रही हूँ — जो जानकारी आपने दी है वो सब उनके पास पहुँच रही है, दोबारा बताने की ज़रूरत नहीं पड़ेगी। लाइन पर बने रहिए।'
    : "Right — I'm putting you through to a colleague now. Everything you've told me goes across with you, so you won't have to repeat any of it. Do stay on the line.";
}

const INTENT_KEYS: ReadonlySet<string> = new Set([
  'order_status',
  'delivery_complaint',
  'cancellation_request',
  'return_request',
  'refund_request',
  'address_change',
  'general_query',
  'unknown',
]);

function isIntentKey(value: string): value is IntentKey {
  return INTENT_KEYS.has(value);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value > 1 ? 1 : value;
}

/** Opening line of a call. Deterministic, so it never drifts. */
export function greeting(language: LanguageCode = 'en'): string {
  return language === 'hi'
    ? 'नमस्ते, मैं आपका अगोरा वॉयस एजेंट बोल रहा हूँ। बताइए, मैं आपकी क्या मदद कर सकता हूँ?'
    : 'Hello, this is your Agora Voice Agent. How can I help you with your order today?';
}

export { createState };
