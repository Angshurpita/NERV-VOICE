import type { PolicyConfig } from "./config.js";
import type { Order, OrderStatus, ReturnPolicyClass } from "./types.js";

/**
 * Commerce policy.
 *
 * Deterministic answers to "may this happen, and who may do it". The model is
 * never asked these questions — it is told the answer and phrases it. That
 * matters most for requirements 6.2 and 6.3, where getting it wrong means either
 * escalating everything (the old behaviour) or letting the AI quietly cancel a
 * parcel already in a courier's hands.
 */

// ── Cancellation (requirement 6.3) ────────────────────────────────────────────

/**
 * Statuses the AI may cancel on its own.
 *
 * Everything up to and including in-transit is reversible without a person: the
 * warehouse pulls it, or it becomes a return-to-origin. Once a rider is holding
 * it for today's delivery, that is no longer true.
 */
const AI_CANCELLABLE: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "PLACED",
  "PACKED",
  "SHIPPED",
  "IN_TRANSIT",
  "DELAYED",
]);

/** Statuses where cancelling needs a person — requirement 6.3. */
const CANCEL_NEEDS_HUMAN: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "OUT_FOR_DELIVERY",
  "DELIVERED",
]);

/** Statuses where there is nothing left to cancel. */
const NOT_CANCELLABLE: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "CANCELLED",
  "RETURNED",
  "REFUNDED",
  "REFUND_PENDING",
  "RETURN_REQUESTED",
  "RETURN_PICKED_UP",
  "RTO",
  "LOST_IN_TRANSIT",
]);

export type CancellationVerdict =
  /** The AI may cancel it now. */
  | { outcome: "ai_may_cancel"; findings: string[] }
  /** Requirement 6.3 — hand to a human, with a reason. */
  | { outcome: "needs_human"; reason: string; findings: string[] }
  /** Nothing to do; explain why. */
  | { outcome: "not_possible"; reason: string; findings: string[] };

export function evaluateCancellation(
  order: Order,
  policy: PolicyConfig,
): CancellationVerdict {
  const findings: string[] = [
    `Order ${order.id} status is ${order.status}.`,
    `Order value ₹${order.totalInr.toLocaleString("en-IN")}, paid by ${paymentLabel(order.paymentMethod)}.`,
  ];

  if (NOT_CANCELLABLE.has(order.status)) {
    return {
      outcome: "not_possible",
      reason: reasonNotCancellable(order.status),
      findings,
    };
  }

  if (CANCEL_NEEDS_HUMAN.has(order.status)) {
    const reason =
      order.status === "OUT_FOR_DELIVERY"
        ? `Order ${order.id} is out for delivery today, so cancelling means intercepting a parcel already with the courier. A human agent must authorise this.`
        : `Order ${order.id} has already been delivered, so this is a return rather than a cancellation and needs a human agent.`;
    findings.push(
      order.status === "OUT_FOR_DELIVERY"
        ? `Courier ${order.courier ?? "unknown"}, tracking ${order.trackingId ?? "unavailable"}.`
        : `Delivered on ${order.deliveredAt ?? "unknown date"}.`,
    );
    return { outcome: "needs_human", reason, findings };
  }

  if (AI_CANCELLABLE.has(order.status)) {
    if (order.totalInr >= policy.highValueInr) {
      findings.push(
        `High-value order (≥ ₹${policy.highValueInr.toLocaleString("en-IN")}) — flagged for review, but cancellation itself is permitted at this stage.`,
      );
    }
    return { outcome: "ai_may_cancel", findings };
  }

  return {
    outcome: "needs_human",
    reason: `Order ${order.id} is in state ${order.status}, which has no automated cancellation path.`,
    findings,
  };
}

function reasonNotCancellable(status: OrderStatus): string {
  switch (status) {
    case "CANCELLED":
      return "This order is already cancelled.";
    case "REFUNDED":
      return "This order has already been refunded.";
    case "REFUND_PENDING":
      return "A refund is already being processed for this order.";
    case "RETURNED":
      return "This order has already been returned.";
    case "RETURN_REQUESTED":
    case "RETURN_PICKED_UP":
      return "A return is already in progress for this order.";
    case "RTO":
      return "This order was already returned to origin.";
    case "LOST_IN_TRANSIT":
      return "This order is marked lost in transit and is being handled as a claim.";
    default:
      return "This order cannot be cancelled.";
  }
}

// ── Returns and refunds (requirement 6.2) ─────────────────────────────────────

export interface ReturnAssessment {
  /** Whether policy would allow the return at all. */
  eligible: boolean;
  /** Days since delivery, or null if not delivered. */
  daysSinceDelivery: number | null;
  /** Deterministic findings for the handover report. */
  findings: string[];
}

/**
 * Assess a return against policy.
 *
 * This never decides the outcome — requirement 6.2 sends every return and refund
 * to a human. What it does is establish the facts *before* the handover, so the
 * agent receives a verified case rather than "caller wants a refund".
 */
export function assessReturn(
  order: Order,
  now: Date = new Date(),
): ReturnAssessment {
  const findings: string[] = [
    `Order ${order.id} status is ${order.status}.`,
    `Order value ₹${order.totalInr.toLocaleString("en-IN")}, paid by ${paymentLabel(order.paymentMethod)}.`,
  ];

  if (order.status === "REFUNDED") {
    findings.push(
      `Already refunded on ${order.refundedAt ?? "an earlier date"} — possible duplicate request.`,
    );
    return { eligible: false, daysSinceDelivery: null, findings };
  }

  if (order.status === "REFUND_PENDING") {
    findings.push(
      "A refund is already in progress — this may be a status chase rather than a new request.",
    );
    return { eligible: false, daysSinceDelivery: null, findings };
  }

  if (
    order.status === "RETURN_REQUESTED" ||
    order.status === "RETURN_PICKED_UP"
  ) {
    findings.push("A return is already open on this order.");
    return { eligible: false, daysSinceDelivery: null, findings };
  }

  if (order.status !== "DELIVERED") {
    findings.push(
      `Not delivered yet, so a return does not apply — this is a cancellation or a delivery issue instead.`,
    );
    return { eligible: false, daysSinceDelivery: null, findings };
  }

  const delivered = order.deliveredAt ? new Date(order.deliveredAt) : null;
  const days = delivered ? daysBetween(delivered, now) : null;
  findings.push(
    delivered
      ? `Delivered ${days} day${days === 1 ? "" : "s"} ago on ${order.deliveredAt}.`
      : "Delivery date missing on the order record.",
  );

  // Category policy is per item, so a mixed basket can be partly returnable.
  const blocked = order.items.filter(
    (i) => i.returnPolicy === "NON_RETURNABLE",
  );
  const replacementOnly = order.items.filter(
    (i) => i.returnPolicy === "REPLACEMENT_ONLY",
  );

  if (blocked.length > 0) {
    findings.push(
      `Non-returnable item(s): ${blocked.map((i) => `${i.name} (${i.category})`).join(", ")}.`,
    );
  }
  if (replacementOnly.length > 0) {
    findings.push(
      `Replacement-only item(s), no refund under policy: ${replacementOnly
        .map((i) => `${i.name} (${i.category})`)
        .join(", ")}.`,
    );
  }

  const withinWindow = days !== null && days <= order.returnWindowDays;
  findings.push(
    withinWindow
      ? `Within the ${order.returnWindowDays}-day return window (${order.returnWindowDays - (days ?? 0)} day(s) remaining).`
      : `Return window of ${order.returnWindowDays} days closed ${days !== null ? days - order.returnWindowDays : "?"} day(s) ago.`,
  );

  const anyReturnable = order.items.some(
    (i) => i.returnPolicy === "RETURNABLE",
  );

  if (order.paymentMethod === "COD") {
    findings.push(
      "Paid cash on delivery — a refund needs bank details collected from the caller.",
    );
  }

  return {
    eligible: withinWindow && anyReturnable && blocked.length === 0,
    daysSinceDelivery: days,
    findings,
  };
}

/** Case priority for a handover, from real order facts rather than sentiment. */
export function priorityFor(
  order: Order | null,
  policy: PolicyConfig,
): "low" | "medium" | "high" | "urgent" {
  if (!order) return "medium";
  if (order.status === "LOST_IN_TRANSIT" || order.status === "REFUND_PENDING")
    return "urgent";
  if (order.totalInr >= policy.highValueInr * 2) return "urgent";
  if (order.totalInr >= policy.highValueInr) return "high";
  if (order.status === "OUT_FOR_DELIVERY" || order.status === "DELAYED")
    return "high";
  if (order.failedDeliveryAttempts >= 2) return "high";
  return "medium";
}

export function paymentLabel(method: Order["paymentMethod"]): string {
  switch (method) {
    case "PREPAID_CARD":
      return "card";
    case "UPI":
      return "UPI";
    case "NET_BANKING":
      return "net banking";
    case "COD":
      return "cash on delivery";
    case "EMI":
      return "card EMI";
    case "WALLET":
      return "wallet";
  }
}

export function returnPolicyLabel(policy: ReturnPolicyClass): string {
  switch (policy) {
    case "RETURNABLE":
      return "returnable";
    case "REPLACEMENT_ONLY":
      return "replacement only";
    case "NON_RETURNABLE":
      return "non-returnable";
  }
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / 86_400_000);
}
