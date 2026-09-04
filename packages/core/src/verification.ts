import type { PolicyConfig } from "./config.js";
import { isOrderScoped } from "./fields.js";
import type { Clock } from "./conversation-state.js";
import { systemClock } from "./conversation-state.js";
import { paymentLabel } from "./order-policy.js";
import type {
  ConversationState,
  Customer,
  Order,
  OrderLookupResult,
  VerificationState,
} from "./types.js";

/**
 * Order verification gate — requirement 7.
 *
 * "For every order the order ID is mandatory, then confirm by telling the
 * details and the name of the orderer and then proceed with the call."
 *
 * The gate is code, not prompt wording. A model told to always confirm will
 * eventually not, especially several turns into a noisy call; `canProceed()` is
 * consulted before any order action regardless of what the model produced, so
 * skipping the read-back is structurally impossible rather than discouraged.
 */

export type VerificationStep =
  /** No order id yet — ask for it. Nothing else may happen first. */
  | "NEED_ORDER_ID"
  /** Order id heard but candidates conflict — read them back, do not guess. */
  | "RESOLVE_AMBIGUOUS_ORDER_ID"
  /** Have an id, haven't looked it up yet. */
  | "LOOKUP_PENDING"
  /** Looked up, no such order — re-ask. */
  | "ORDER_NOT_FOUND"
  /** Order service is down. */
  | "BACKEND_UNAVAILABLE"
  /** Need the caller's name to check it against the order. */
  | "NEED_NAME"
  /** Name given does not match the order — do not disclose details. */
  | "NAME_MISMATCH"
  /** Read the order details + orderer name back and await confirmation. */
  | "READ_BACK_REQUIRED"
  /** Read back, waiting for yes/no. */
  | "AWAITING_CONFIRMATION"
  /** Fully verified; the call may proceed. */
  | "VERIFIED";

export interface VerificationPlan {
  step: VerificationStep;
  /** True when order-specific work may proceed. */
  canProceed: boolean;
  /** Instruction for the LLM. It phrases this; it does not choose it. */
  guidance: string;
}

/**
 * What must happen next before this call may act on an order.
 *
 * `general_query` is the one intent that bypasses the gate, because it covers
 * questions with no order attached ("what's your return policy?"). Everything
 * else runs the full sequence.
 */
export function planVerification(
  state: ConversationState,
  policy: PolicyConfig,
  order: Order | null,
): VerificationPlan {
  if (!isOrderScoped(state.intent.value)) {
    return {
      step: "VERIFIED",
      canProceed: true,
      guidance:
        "No specific order is involved, so answer the question directly.",
    };
  }

  const v = state.verification;
  const field = state.requiredInformation.orderId;

  // 1 — the order id itself.
  if (!field || field.candidates.length === 0) {
    return {
      step: "NEED_ORDER_ID",
      canProceed: false,
      guidance:
        "You do not have an order number yet, and you cannot check anything without one. Ask for " +
        "it in one short sentence. Do not guess, do not offer to look it up by name, and do not " +
        "promise anything about the order until you have it.",
    };
  }

  // Conflicting candidates: never pick one. Two ids one digit apart can belong
  // to different customers, so resolving it wrongly discloses someone else's
  // purchase.
  if (field.value === null) {
    return {
      step: "RESOLVE_AMBIGUOUS_ORDER_ID",
      canProceed: false,
      guidance:
        `You heard more than one possible order number (${field.display}). Do not choose between ` +
        "them and do not look either up. Say plainly that you caught two different numbers, read " +
        "both back digit by digit, and ask which one is right.",
    };
  }

  if (!v.lookedUp) {
    return {
      step: "LOOKUP_PENDING",
      canProceed: false,
      guidance: `Look up order ${field.value} before saying anything about it.`,
    };
  }

  if (v.lookupOutcome === "backend_unavailable") {
    return {
      step: "BACKEND_UNAVAILABLE",
      canProceed: false,
      guidance:
        "The order system did not respond. Say so honestly and briefly — do not invent a status, " +
        "and do not imply you can see the order. A colleague will take over.",
    };
  }

  if (v.lookupOutcome === "not_found") {
    return {
      step: "ORDER_NOT_FOUND",
      canProceed: false,
      guidance:
        `No order matches ${field.value}. Tell the caller that number does not match anything, ` +
        "read back what you heard so they can correct a digit, and ask them to check it. Stay " +
        "friendly — most of the time a digit was simply misheard.",
    };
  }

  // 2 — the name on the order (requirement 7: "the name of the orderer").
  const identity = state.requiredInformation.customerIdentity;
  if (!identity || identity.candidates.length === 0) {
    return {
      step: "NEED_NAME",
      canProceed: false,
      guidance:
        "You have found the order but must not read its contents out yet. Ask whose name the " +
        "order was placed under. Do not reveal the name you can see — that would defeat the check.",
    };
  }

  if (v.nameMatches === false) {
    return {
      step: "NAME_MISMATCH",
      canProceed: false,
      guidance:
        "The name given does not match the name on the order. Do not reveal any order details, " +
        "the correct name, or even what the item is. Say only that the name does not match the " +
        "record and ask them to confirm the name exactly as it was entered when ordering. Stay " +
        "polite; this is usually a nickname or a spelling difference, not fraud.",
    };
  }

  // 3 — read the details back and get an explicit yes.
  if (!v.readBack) {
    return {
      step: "READ_BACK_REQUIRED",
      canProceed: false,
      guidance: order
        ? `Read this back and ask the caller to confirm it is their order: ${describeOrder(order, v.ordererName)}. ` +
          `Confirm the order ID digit by digit, state the orderer name (${v.ordererName ?? "customer name on file"}), and item details. ` +
          "Ask a direct yes/no question at the end. Do not answer their request or proceed until they confirm."
        : "Read the order details and orderer name back and ask the caller to confirm.",
    };
  }

  if (!v.confirmed) {
    return {
      step: "AWAITING_CONFIRMATION",
      canProceed: false,
      guidance:
        "You have read the details back and the caller has not clearly said yes. Ask once more, " +
        "plainly: is this the right order? Do not proceed on a maybe.",
    };
  }

  return {
    step: "VERIFIED",
    canProceed: true,
    guidance:
      "The order is confirmed and the caller is verified. Deal with what they actually asked for.",
  };
}

/**
 * A one-line, speakable summary of an order.
 *
 * Includes exactly the five things requirement 7 asks be confirmed — order id,
 * orderer name, item, status and value — plus the delivery date, because it is
 * the fact callers most often use to recognise their own order.
 */
export function describeOrder(
  order: Order,
  ordererName?: string | null,
): string {
  const item = order.items[0]?.name ?? "item";
  const extra =
    order.items.length > 1 ? ` and ${order.items.length - 1} more item(s)` : "";
  const name = ordererName ? `, placed by ${ordererName}` : "";
  const total = `₹${order.totalInr.toLocaleString("en-IN")}`;
  const due =
    order.status === "DELIVERED" && order.deliveredAt
      ? `delivered on ${order.deliveredAt}`
      : `expected ${order.expectedDeliveryAt}`;
  return `order ${order.id}${name} — ${item}${extra}, ${total} paid by ${paymentLabel(order.paymentMethod)}, currently ${humanStatus(order.status)}, ${due}`;
}

export function humanStatus(status: Order["status"]): string {
  return status.toLowerCase().replace(/_/g, " ");
}

// ── State transitions ─────────────────────────────────────────────────────────

/** Record the result of an order lookup. Only this sets `lookedUp`. */
export function applyLookup(
  state: ConversationState,
  result: OrderLookupResult,
  clock: Clock = systemClock,
): ConversationState {
  const base: VerificationState = {
    ...state.verification,
    orderId:
      state.requiredInformation.orderId?.value ?? state.verification.orderId,
    lookedUp: true,
    lookupOutcome: result.outcome === "found" ? "found" : result.outcome,
  };

  const verification: VerificationState =
    result.outcome === "found"
      ? { ...base, ordererName: result.customer.name }
      : { ...base, ordererName: null, attempts: base.attempts + 1 };

  return {
    ...state,
    verification,
    customer:
      result.outcome === "found"
        ? { ...state.customer, id: result.customer.id }
        : state.customer,
    knownOrderStatuses:
      result.outcome === "found"
        ? {
            ...state.knownOrderStatuses,
            [result.order.id]: result.order.status,
          }
        : state.knownOrderStatuses,
    updatedAt: clock.now().toISOString(),
  };
}

/**
 * Check the name the caller gave against the name on the order.
 *
 * Deliberately lenient about form and strict about identity: first-name-only,
 * reversed order and extra middle names all pass, because callers rarely say
 * their full legal name to a phone line, while a genuinely different person
 * fails. A single shared token is not enough on its own unless it is the whole
 * name given.
 */
export function applyNameCheck(
  state: ConversationState,
  claimedName: string,
  actualName: string,
  clock: Clock = systemClock,
): ConversationState {
  return {
    ...state,
    verification: {
      ...state.verification,
      nameMatches: namesMatch(claimedName, actualName),
      attempts: namesMatch(claimedName, actualName)
        ? state.verification.attempts
        : state.verification.attempts + 1,
    },
    updatedAt: clock.now().toISOString(),
  };
}

export function namesMatch(claimed: string, actual: string): boolean {
  const a = tokens(claimed);
  const b = tokens(actual);
  if (a.length === 0 || b.length === 0) return false;

  // Exact set match in any order.
  if (a.length === b.length && a.every((t) => b.includes(t))) return true;

  // Caller gave a subset of the recorded name ("Rahul" for "Rahul Sharma"), or
  // a superset ("Rahul Kumar Sharma" for "Rahul Sharma").
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.every((t) => longer.includes(t));
}

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !HONORIFICS.has(t));
}

const HONORIFICS = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "shri",
  "smt",
  "sri",
]);

/** Mark that the AI has read the order details back to the caller. */
export function markReadBack(
  state: ConversationState,
  clock: Clock = systemClock,
): ConversationState {
  return {
    ...state,
    verification: { ...state.verification, readBack: true },
    updatedAt: clock.now().toISOString(),
  };
}

/**
 * Apply the caller's yes/no to the order read-back.
 *
 * A "no" resets the whole gate — id, lookup and name all go — because the
 * caller has told us the order we found is not theirs, and keeping any of it
 * would let a wrong order resurface later in the call.
 */
export function applyOrderConfirmation(
  state: ConversationState,
  accepted: boolean,
  clock: Clock = systemClock,
): ConversationState {
  const at = clock.now().toISOString();

  if (accepted) {
    return {
      ...state,
      verification: { ...state.verification, confirmed: true },
      customer: { ...state.customer, identityVerified: true },
      updatedAt: at,
    };
  }

  const { orderId: _dropped, ...rest } = state.requiredInformation;
  return {
    ...state,
    verification: {
      orderId: null,
      lookedUp: false,
      lookupOutcome: null,
      ordererName: null,
      readBack: false,
      confirmed: false,
      nameMatches: null,
      attempts: state.verification.attempts + 1,
    },
    requiredInformation: rest,
    updatedAt: at,
  };
}

/** True when order-specific work may proceed. */
export function isVerified(state: ConversationState): boolean {
  if (!isOrderScoped(state.intent.value)) return true;
  return (
    state.verification.confirmed && state.verification.nameMatches !== false
  );
}

/** Build the `Customer`-shaped identity the dashboard displays. */
export function verifiedIdentity(
  state: ConversationState,
  customer: Customer | null,
): {
  name: string | null;
  verified: boolean;
} {
  return {
    name: customer?.name ?? state.customer.name,
    verified: isVerified(state),
  };
}
