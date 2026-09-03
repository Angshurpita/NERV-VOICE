import type { PolicyConfig } from './config.js';
import { reasonFieldFor } from './fields.js';
import { assessReturn, evaluateCancellation } from './order-policy.js';
import { planRetention } from './persuasion.js';
import type {
  ConversationState,
  EscalationReason,
  Order,
  VerificationReport,
} from './types.js';

/**
 * Escalation engine — requirement 6.
 *
 * The previous implementation had nine triggers, six of which fired on ordinary
 * friction: low confidence, an unresolved field, a frustrated tone, a
 * misheard sentence, "needs judgement", failed authentication. Combined with a
 * prompt that said *"if they want to cancel, refund, or return an order you MUST
 * escalate"*, almost every real call ended up with a human.
 *
 * This version escalates for three business reasons only:
 *
 *   1. The caller has insisted on a human several times, after genuine attempts
 *      to help (`persuasion.ts` runs the ladder).
 *   2. A return or refund — but only once the AI has verified the case, so the
 *      human inherits a checked file rather than a raw request.
 *   3. A cancellation of something already out for delivery.
 *
 * Plus two floors that are not judgement calls: a safety domain an AI must not
 * counsel, and an order service that is down so there is no truthful answer to
 * give. Everything else the AI finishes itself.
 */

export interface EscalationSignals {
  /** Safety engine blocked the topic and asked for a person. */
  safetyEscalation?: boolean;
  /** A required backend call failed this turn. */
  backendFailure?: boolean;
  /** Lexical hints from the caller's words, cross-checking the model's intent. */
  hints?: { cancel: boolean; return_: boolean; refund: boolean };
}

export interface EscalationDecision {
  required: boolean;
  reason: EscalationReason | null;
  detail: string | null;
  report: VerificationReport | null;
  /**
   * True when the AI should keep working rather than hand over, even though the
   * caller raised a hand-over-shaped topic — because verification is not done.
   */
  blockedPendingVerification: boolean;
}

const NO_ESCALATION: EscalationDecision = {
  required: false,
  reason: null,
  detail: null,
  report: null,
  blockedPendingVerification: false,
};

export function evaluateEscalation(
  state: ConversationState,
  policy: PolicyConfig,
  order: Order | null,
  signals: EscalationSignals = {},
  now: Date = new Date(),
): EscalationDecision {
  // ── Floor 1: safety. A blocked domain outranks everything. ────────────────
  if (signals.safetyEscalation) {
    return {
      required: true,
      reason: 'SAFETY_POLICY',
      detail: 'The request falls in a domain the AI is not permitted to advise on.',
      report: buildReport(state, order, now, ['Safety policy triggered; no commerce checks run.']),
      blockedPendingVerification: false,
    };
  }

  // ── Floor 2: no truthful answer available. ────────────────────────────────
  if (signals.backendFailure || state.verification.lookupOutcome === 'backend_unavailable') {
    return {
      required: true,
      reason: 'BACKEND_FAILURE',
      detail: 'The order service did not respond, so the AI has no verified information to act on.',
      report: buildReport(state, order, now, ['Order lookup failed — status could not be verified.']),
      blockedPendingVerification: false,
    };
  }

  // ── 1: the caller has insisted. ───────────────────────────────────────────
  const retention = planRetention(state, policy, order);
  if (retention.stance === 'HAND_OVER') {
    return {
      required: true,
      reason: 'CUSTOMER_INSISTED_HUMAN',
      detail:
        `The caller asked for a human ${state.humanRequestCount} times` +
        (state.refusedAiHelp ? ' and explicitly rejected AI help' : '') +
        `, after ${Math.min(state.humanRequestCount - 1, 2)} attempt(s) to resolve it directly.`,
      report: buildReport(state, order, now),
      blockedPendingVerification: false,
    };
  }

  const intent = state.intent.value;
  const hints = signals.hints ?? { cancel: false, return_: false, refund: false };

  // Cross-check the model against the caller's own words. A model that labels
  // "I want my money back" as `order_status` would otherwise bypass rule 2.
  const wantsRefundOrReturn =
    intent === 'refund_request' || intent === 'return_request' || hints.refund || hints.return_;
  const wantsCancel = intent === 'cancellation_request' || hints.cancel;

  // ── 2: return or refund → human, but only once verified. ──────────────────
  if (wantsRefundOrReturn) {
    // Requirement 6.2 asks for "a proper reason verification from your end".
    // Handing over before the order is confirmed would defeat that, so the AI
    // finishes verifying first.
    if (!verificationComplete(state)) {
      return { ...NO_ESCALATION, blockedPendingVerification: true };
    }

    const assessment = order ? assessReturn(order, now) : null;
    const kind = intent === 'return_request' || hints.return_ ? 'return' : 'refund';

    return {
      required: true,
      reason: 'REFUND_OR_RETURN',
      detail:
        `Caller is requesting a ${kind}. Order and identity verified by the AI; ` +
        `${kind} decisions require a human agent.` +
        (assessment
          ? assessment.eligible
            ? ' Policy check: eligible.'
            : ' Policy check: NOT eligible on the automated criteria — see findings.'
          : ''),
      report: buildReport(state, order, now, assessment?.findings ?? []),
      blockedPendingVerification: false,
    };
  }

  // ── 3: cancelling something already out for delivery. ─────────────────────
  if (wantsCancel && order) {
    if (!verificationComplete(state)) {
      return { ...NO_ESCALATION, blockedPendingVerification: true };
    }

    const verdict = evaluateCancellation(order, policy);
    if (verdict.outcome === 'needs_human') {
      return {
        required: true,
        reason: 'CANCEL_WHILE_OUT_FOR_DELIVERY',
        detail: verdict.reason,
        report: buildReport(state, order, now, verdict.findings),
        blockedPendingVerification: false,
      };
    }
    // 'ai_may_cancel' and 'not_possible' are both handled by the AI.
  }

  return NO_ESCALATION;
}

/**
 * Whether the AI has established enough to hand over responsibly.
 *
 * Note this gates *escalation*, not helpfulness: an unverified refund request
 * does not escalate, it keeps verifying.
 */
function verificationComplete(state: ConversationState): boolean {
  const v = state.verification;
  return v.confirmed && v.nameMatches !== false && v.lookupOutcome === 'found';
}

/**
 * Assemble the handover file.
 *
 * This is the substance of requirement 6.2. The human agent picks up a case that
 * already states what was proven, what the policy says, and what is still open —
 * so the caller is not asked the same six questions a second time.
 */
export function buildReport(
  state: ConversationState,
  order: Order | null,
  _now: Date = new Date(),
  extraFindings: string[] = [],
): VerificationReport {
  const v = state.verification;
  const reasonField = reasonFieldFor(state.intent.value);
  const statedReason = reasonField
    ? state.requiredInformation[reasonField]?.value ??
      state.requiredInformation[reasonField]?.candidates.at(-1)?.value ??
      null
    : null;

  const outstanding: string[] = [];
  if (!v.confirmed) outstanding.push('Order not confirmed by the caller.');
  if (v.nameMatches === false) outstanding.push('Name given did not match the name on the order.');
  if (v.nameMatches === null) outstanding.push('Caller name not checked against the order.');
  if (!order) outstanding.push('No order record retrieved.');
  if (reasonField && !statedReason) outstanding.push('Caller did not give a clear reason.');

  const policyFindings = [...extraFindings];
  if (order && order.failedDeliveryAttempts > 0) {
    policyFindings.push(`${order.failedDeliveryAttempts} failed delivery attempt(s) on record.`);
  }

  return {
    orderId: v.orderId ?? state.requiredInformation.orderId?.value ?? null,
    ordererName: v.ordererName,
    orderStatus: order?.status ?? null,
    orderTotalInr: order?.totalInr ?? null,
    identityConfirmed: v.nameMatches === true,
    orderConfirmed: v.confirmed,
    statedReason,
    policyFindings,
    outstanding,
  };
}

/** Record an escalation decision on the state. */
export function applyEscalation(
  state: ConversationState,
  decision: EscalationDecision,
  now: Date = new Date(),
): ConversationState {
  if (!decision.required) return state;

  return {
    ...state,
    phase: 'escalating',
    escalation: {
      required: true,
      reason: decision.reason,
      detail: decision.detail,
      report: decision.report,
      triggeredAt: now.toISOString(),
    },
    updatedAt: now.toISOString(),
  };
}

/** Operator-facing label for a reason code. */
export function escalationLabel(reason: EscalationReason): string {
  switch (reason) {
    case 'CUSTOMER_INSISTED_HUMAN':
      return 'Caller insisted on a human';
    case 'REFUND_OR_RETURN':
      return 'Refund / return decision';
    case 'CANCEL_WHILE_OUT_FOR_DELIVERY':
      return 'Cancellation after dispatch';
    case 'SAFETY_POLICY':
      return 'Safety policy';
    case 'BACKEND_FAILURE':
      return 'System failure';
  }
}
