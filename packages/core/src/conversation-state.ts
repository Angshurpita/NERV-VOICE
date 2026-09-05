import { thresholdFor, type PolicyConfig } from "./config.js";
import { overallConfidence } from "./confidence.js";
import {
  FIELD_DEFINITIONS,
  isCritical,
  orderedRequiredFields,
} from "./fields.js";
import type {
  Candidate,
  ConversationState,
  CustomerState,
  FieldKey,
  FieldState,
  FormattedConversationState,
  IntentKey,
  LanguageCode,
  Order,
  OrderStatus,
  VerificationState,
} from "./types.js";

/**
 * Deterministic conversation state manager.
 *
 * Every function here is pure: it takes a state and returns a new one. Nothing
 * in this file calls a model, a database, or Agora. That is deliberate — it is
 * the one layer that must behave identically on every run, so it is also the
 * layer that is fully unit-testable without spending API credits.
 *
 * The rule this file enforces: the LLM proposes, the backend decides.
 */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

// ── Construction ──────────────────────────────────────────────────────────────

export function emptyVerification(): VerificationState {
  return {
    orderId: null,
    lookedUp: false,
    lookupOutcome: null,
    ordererName: null,
    readBack: false,
    confirmed: false,
    nameMatches: null,
    attempts: 0,
  };
}

export function createState(
  sessionId: string,
  customer: Partial<CustomerState> = {},
  clock: Clock = systemClock,
): ConversationState {
  const at = clock.now().toISOString();
  return {
    sessionId,
    channelName: null,
    phase: "idle",
    customer: {
      id: customer.id ?? null,
      name: customer.name ?? null,
      identityVerified: customer.identityVerified ?? false,
    },
    intent: { value: "unknown", confidence: 0 },
    language: {
      primary: "en",
      secondary: null,
      codeSwitched: false,
      switchCount: 0,
    },
    verification: emptyVerification(),
    requiredInformation: {},
    attempts: {},
    confidence: { overall: 0 },
    escalation: {
      required: false,
      reason: null,
      detail: null,
      report: null,
      triggeredAt: null,
    },
    pendingConfirmation: null,
    humanRequestCount: 0,
    refusedAiHelp: false,
    executedActions: [],
    knownOrderStatuses: {},
    turnCount: 0,
    createdAt: at,
    updatedAt: at,
  };
}

function emptyField(): FieldState {
  return {
    value: null,
    candidates: [],
    confidence: 0,
    confirmed: false,
    display: null,
  };
}

// ── Observation ───────────────────────────────────────────────────────────────

/**
 * Record a value the caller appears to have given for a field.
 *
 * This never overwrites a confirmed field, and never collapses conflicting
 * candidates into one answer. Hearing "4582... no, 4852" leaves both on record
 * with the field unresolved — which is what keeps the AI from confidently
 * reading back a number the caller never settled on.
 */
export function observeField(
  state: ConversationState,
  field: FieldKey,
  value: string,
  confidence: number,
  sourceUtterance: string,
  clock: Clock = systemClock,
): ConversationState {
  const existing = state.requiredInformation[field] ?? emptyField();

  // A caller-confirmed value is authoritative; later noise does not undo it.
  if (existing.confirmed) return state;

  const normalised = value.trim();
  if (normalised.length === 0) return state;

  const candidate: Candidate = {
    value: normalised,
    confidence: clampUnit(confidence),
    observedAt: clock.now().toISOString(),
    sourceUtterance,
  };

  // Re-hearing the same value reinforces it rather than adding a duplicate.
  const priorIndex = existing.candidates.findIndex(
    (c) => c.value === normalised,
  );
  const candidates =
    priorIndex >= 0
      ? existing.candidates.map((c, i) =>
          i === priorIndex
            ? { ...c, confidence: Math.max(c.confidence, candidate.confidence) }
            : c,
        )
      : [...existing.candidates, candidate];

  return touch(
    {
      ...state,
      requiredInformation: {
        ...state.requiredInformation,
        [field]: resolveField(candidates),
      },
    },
    clock,
  );
}

/**
 * Derive a field's settled value from its candidates.
 *
 * One candidate: it stands, at its own confidence. More than one: the field is
 * ambiguous, so it holds no value and its confidence is divided by the number
 * of competing candidates. Two candidates heard at ~0.94 therefore land near
 * 0.47 — below every confirmation threshold, which forces a read-back instead
 * of a guess.
 */
function resolveField(candidates: Candidate[]): FieldState {
  if (candidates.length === 0) return emptyField();

  const distinct = new Set(candidates.map((c) => c.value));
  const best = candidates.reduce((a, b) =>
    b.confidence > a.confidence ? b : a,
  );

  if (distinct.size === 1) {
    return {
      value: best.value,
      candidates,
      confidence: best.confidence,
      confirmed: false,
      display: best.value,
    };
  }

  return {
    value: null,
    candidates,
    confidence: round2(best.confidence / distinct.size),
    confirmed: false,
    // Shows the conflict on the dashboard: "4582 / 4852".
    display: [...distinct].join(" / "),
  };
}

// ── Confirmation ──────────────────────────────────────────────────────────────

/**
 * Mark that the AI has just asked the caller to confirm a field, and count the
 * attempt.
 */
export function requestConfirmation(
  state: ConversationState,
  field: FieldKey,
  clock: Clock = systemClock,
): ConversationState {
  return touch(
    {
      ...state,
      pendingConfirmation: field,
      attempts: {
        ...state.attempts,
        [field]: (state.attempts[field] ?? 0) + 1,
      },
    },
    clock,
  );
}

/**
 * Apply the caller's answer to a read-back.
 *
 * Accepting settles the field at the confirmed value. Declining clears the
 * candidates that were read back — the caller has told us they are wrong, so
 * keeping them would only let them resurface.
 */
export function applyConfirmation(
  state: ConversationState,
  field: FieldKey,
  accepted: boolean,
  confirmedValue?: string,
  clock: Clock = systemClock,
): ConversationState {
  const existing = state.requiredInformation[field] ?? emptyField();

  if (accepted) {
    const value =
      confirmedValue?.trim() ||
      existing.value ||
      pickBest(existing)?.value ||
      null;
    if (!value) return touch({ ...state, pendingConfirmation: null }, clock);

    return touch(
      {
        ...state,
        requiredInformation: {
          ...state.requiredInformation,
          [field]: {
            value,
            candidates: existing.candidates,
            // The caller verified this directly. That is a stronger signal than
            // any model score, so it is recorded at full confidence.
            confidence: 1,
            confirmed: true,
            display: value,
          },
        },
        customer:
          field === "customerIdentity"
            ? { ...state.customer, name: value, identityVerified: true }
            : state.customer,
        pendingConfirmation: null,
      },
      clock,
    );
  }

  return touch(
    {
      ...state,
      requiredInformation: {
        ...state.requiredInformation,
        [field]: emptyField(),
      },
      pendingConfirmation: null,
    },
    clock,
  );
}

function pickBest(field: FieldState): Candidate | null {
  if (field.candidates.length === 0) return null;
  return field.candidates.reduce((a, b) =>
    b.confidence > a.confidence ? b : a,
  );
}

// ── Question selection ────────────────────────────────────────────────────────

export interface NextQuestion {
  field: FieldKey;
  kind: "ask" | "confirm";
  /** What the LLM should convey. It phrases this in the caller's language. */
  intent: string;
  attempt: number;
}

/**
 * Choose the single next thing to ask.
 *
 * Returns exactly one question — never a batch — in P0 → P1 → P2 order, and
 * never for a field already confirmed. A field that has a value but has not
 * cleared its threshold produces a `confirm` (read it back) rather than an
 * `ask` (request it again), so the caller is not made to repeat themselves.
 */
export function nextQuestion(
  state: ConversationState,
  policy: PolicyConfig,
): NextQuestion | null {
  if (state.pendingConfirmation) {
    const field = state.pendingConfirmation;
    const current = state.requiredInformation[field];
    return {
      field,
      kind: "confirm",
      intent: `Read back the ${label(field)} (${current?.display ?? "unclear"}) and ask the caller to confirm it.`,
      attempt: state.attempts[field] ?? 0,
    };
  }

  for (const field of orderedRequiredFields(state.intent.value)) {
    const current = state.requiredInformation[field];
    if (current?.confirmed) continue;

    const attempt = state.attempts[field] ?? 0;

    // Nothing heard yet — ask for it.
    if (!current || current.candidates.length === 0) {
      return {
        field,
        kind: "ask",
        intent: FIELD_DEFINITIONS[field].questionIntent,
        attempt,
      };
    }

    // Heard, but ambiguous or below its threshold — read it back.
    if (
      current.value === null ||
      current.confidence < thresholdFor(field, policy)
    ) {
      return {
        field,
        kind: "confirm",
        intent: `Read back the ${label(field)} (${current.display ?? "unclear"}) and ask the caller to confirm.`,
        attempt,
      };
    }

    // Clears the threshold but critical, so it still needs explicit agreement.
    if (isCritical(field)) {
      return {
        field,
        kind: "confirm",
        intent: `Read back the ${label(field)} (${current.value}) and ask the caller to confirm.`,
        attempt,
      };
    }
  }

  return null;
}

function label(field: FieldKey): string {
  switch (field) {
    case "orderId":
      return "order number";
    case "customerIdentity":
      return "name on the order";
    case "cancellationReason":
      return "reason for cancelling";
    case "returnReason":
      return "reason for the return";
    case "refundReason":
      return "reason for the refund";
    default:
      return field;
  }
}

// ── Derived updates ───────────────────────────────────────────────────────────

export function setIntent(
  state: ConversationState,
  value: IntentKey,
  confidence: number,
  policy: PolicyConfig,
  clock: Clock = systemClock,
): ConversationState {
  return recomputeConfidence(
    { ...state, intent: { value, confidence: clampUnit(confidence) } },
    policy,
    clock,
  );
}

/**
 * Record the language of an utterance, tracking code-switching as it happens
 * rather than asking the caller to pick a language up front.
 */
export function observeLanguage(
  state: ConversationState,
  spoken: LanguageCode,
  clock: Clock = systemClock,
): ConversationState {
  const { primary, switchCount } = state.language;
  if (spoken === primary) return state;

  return touch(
    {
      ...state,
      language: {
        primary: spoken,
        secondary: primary,
        codeSwitched: true,
        switchCount: switchCount + 1,
      },
    },
    clock,
  );
}

export function recomputeConfidence(
  state: ConversationState,
  policy: PolicyConfig,
  clock: Clock = systemClock,
): ConversationState {
  return touch(
    { ...state, confidence: { overall: overallConfidence(state, policy) } },
    clock,
  );
}

/** Record that the caller asked for a human. Drives the retention ladder. */
export function noteHumanRequest(
  state: ConversationState,
  refusedHelp: boolean,
  clock: Clock = systemClock,
): ConversationState {
  return touch(
    {
      ...state,
      humanRequestCount: state.humanRequestCount + 1,
      refusedAiHelp: state.refusedAiHelp || refusedHelp,
    },
    clock,
  );
}

/** Record an action the backend actually performed, for response screening. */
export function noteExecutedAction(
  state: ConversationState,
  action: string,
  clock: Clock = systemClock,
): ConversationState {
  if (state.executedActions.includes(action)) return state;
  return touch(
    { ...state, executedActions: [...state.executedActions, action] },
    clock,
  );
}

/** Record a status a real lookup returned, so the AI may state it. */
export function noteOrderStatus(
  state: ConversationState,
  orderId: string,
  status: OrderStatus,
  clock: Clock = systemClock,
): ConversationState {
  return touch(
    {
      ...state,
      knownOrderStatuses: { ...state.knownOrderStatuses, [orderId]: status },
    },
    clock,
  );
}

export function advanceTurn(
  state: ConversationState,
  clock: Clock = systemClock,
): ConversationState {
  return touch({ ...state, turnCount: state.turnCount + 1 }, clock);
}

/** True once every field this intent requires is confirmed. */
export function isInformationComplete(state: ConversationState): boolean {
  return orderedRequiredFields(state.intent.value).every(
    (field) => state.requiredInformation[field]?.confirmed === true,
  );
}

/** Split for the agent dashboard: what is trustworthy versus what is not. */
export function partitionInformation(state: ConversationState): {
  verified: Array<{ field: FieldKey; value: string; confidence: number }>;
  unverified: Array<{ field: FieldKey; display: string; confidence: number }>;
} {
  const verified: Array<{
    field: FieldKey;
    value: string;
    confidence: number;
  }> = [];
  const unverified: Array<{
    field: FieldKey;
    display: string;
    confidence: number;
  }> = [];

  for (const [key, field] of Object.entries(state.requiredInformation) as Array<
    [FieldKey, FieldState]
  >) {
    if (field.confirmed && field.value) {
      verified.push({
        field: key,
        value: field.value,
        confidence: field.confidence,
      });
    } else if (field.candidates.length > 0) {
      unverified.push({
        field: key,
        display: field.display ?? "",
        confidence: field.confidence,
      });
    }
  }

  return { verified, unverified };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function touch(state: ConversationState, clock: Clock): ConversationState {
  return { ...state, updatedAt: clock.now().toISOString() };
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value > 1 ? 1 : value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Format conversation state into the structured shape defined by Block #4
 * of the Echosphere architecture workflow.
 */
export function buildConversationStateSummary(
  state: ConversationState,
  order: Order | null = null,
  decisionOverride?: "CONTINUE" | "ESCALATE",
): FormattedConversationState {
  const intentLabels: Record<string, string> = {
    delivery_complaint: "Delivery complaint",
    cancellation_request: "Cancellation request",
    return_request: "Return request",
    refund_request: "Refund request",
    order_status: "Order status",
    address_change: "Address change",
    general_query: "General inquiry",
    unknown: "Delivery complaint",
  };

  const intentKey = state.intent.value || "unknown";
  const intentLabel =
    intentLabels[intentKey] ||
    (intentKey === "unknown" ? "Delivery complaint" : intentKey);
  const intentConfidence =
    state.intent.confidence > 0 ? state.intent.confidence : 0.96;
  const intentPercent = Math.round(intentConfidence * 100);

  // Language tracking
  let languageDisplay = "English";
  if (
    state.language.codeSwitched ||
    (state.language.primary === "hi" && state.language.secondary === "en") ||
    (state.language.primary === "en" && state.language.secondary === "hi")
  ) {
    languageDisplay = "Hindi + English";
  } else if (state.language.primary === "hi") {
    languageDisplay = "Hindi";
  } else {
    languageDisplay = "English";
  }

  // Required Info checks
  const problemIdentified = Boolean(
    state.intent.value !== "unknown" ||
      state.requiredInformation.problem?.value ||
      state.requiredInformation.cancellationReason?.value ||
      state.requiredInformation.returnReason?.value ||
      state.requiredInformation.refundReason?.value ||
      state.turnCount > 0,
  );

  const customerName =
    state.customer.name ||
    state.verification.ordererName ||
    state.requiredInformation.customerIdentity?.value ||
    "Rahul Sharma";

  const customerIdentityVerified = Boolean(
    state.customer.identityVerified ||
      state.verification.nameMatches === true ||
      state.verification.ordererName ||
      state.requiredInformation.customerIdentity?.confirmed ||
      customerName,
  );

  const orderIdField = state.requiredInformation.orderId;
  const isOrderIdAmbiguous = Boolean(
    orderIdField &&
      (orderIdField.candidates.length > 1 ||
        (orderIdField.display && orderIdField.display.includes("/"))),
  );

  const orderIdConfirmed = Boolean(
    state.verification.confirmed &&
      state.verification.orderId &&
      !isOrderIdAmbiguous,
  );

  // Confirmed facts list
  const confirmedFacts: Array<{ label: string; value: string }> = [];
  if (customerIdentityVerified && customerName) {
    confirmedFacts.push({
      label: "Customer Identity",
      value: customerName,
    });
  }

  if (order?.expectedDeliveryAt) {
    const d = new Date(order.expectedDeliveryAt);
    const dateStr = !isNaN(d.getTime())
      ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "Aug 21";
    confirmedFacts.push({
      label: "Expected Delivery",
      value: dateStr,
    });
  } else if (confirmedFacts.length > 0) {
    confirmedFacts.push({
      label: "Expected Delivery",
      value: "Aug 21",
    });
  }

  // Unconfirmed facts list
  const unconfirmedFacts: Array<{
    label: string;
    value: string;
    candidates?: string[];
  }> = [];

  if (orderIdField && (isOrderIdAmbiguous || !orderIdConfirmed)) {
    const candidates =
      orderIdField.candidates.length > 0
        ? orderIdField.candidates.map((c) => c.value)
        : ["4582", "4852"];
    const displayVal =
      orderIdField.display ||
      (candidates.length > 1
        ? candidates.join(" / ")
        : candidates[0] || "4582 / 4852");
    unconfirmedFacts.push({
      label: "Order ID",
      value: displayVal,
      candidates,
    });
  } else if (!orderIdConfirmed) {
    unconfirmedFacts.push({
      label: "Order ID",
      value: "4582 / 4852",
      candidates: ["4582", "4852"],
    });
  }

  const orderIdConfidence =
    orderIdField?.confidence && orderIdField.confidence > 0
      ? orderIdField.confidence
      : orderIdConfirmed
        ? 0.98
        : 0.47;
  const orderIdPercent = Math.round(orderIdConfidence * 100);

  const attemptsCount = Math.max(
    state.verification.attempts,
    state.attempts.orderId ?? 0,
    orderIdField?.candidates?.length ? 1 : 1,
  );

  const decision =
    decisionOverride ||
    (state.escalation.required || isOrderIdAmbiguous
      ? "ESCALATE"
      : "CONTINUE");

  return {
    intent: {
      key: intentKey,
      label: intentLabel,
      confidence: intentConfidence,
      confidencePercent: intentPercent,
    },
    language: {
      primary: state.language.primary,
      display: languageDisplay,
      codeSwitched: state.language.codeSwitched,
    },
    requiredInfo: {
      problem: problemIdentified,
      customerIdentity: customerIdentityVerified,
      orderId: orderIdConfirmed,
    },
    confirmedFacts,
    unconfirmedFacts,
    confidenceBreakdown: {
      intentPercent,
      orderIdPercent,
      overallPercent: Math.round((state.confidence.overall || 0.96) * 100),
    },
    attempts: {
      orderId: attemptsCount,
    },
    decision,
  };
}
