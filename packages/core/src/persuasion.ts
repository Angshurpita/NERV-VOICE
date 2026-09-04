import type { PolicyConfig } from "./config.js";
import type { ConversationState, Order, RetentionStance } from "./types.js";

/**
 * Retention ladder — requirement 6.1.
 *
 * "Do not escalate the call to a human easily. Escalate only if the caller
 * insists multiple times; initially try to convince."
 *
 * The old behaviour handed over on the caller's *first* mention of a human,
 * with the comment "honoured without argument". That is what this replaces.
 * Two genuine attempts to help come first, and each attempt has to be
 * *substantive* — a stall ("I can help you with that!") that offers nothing
 * concrete just annoys the caller into asking again, so `guidanceFor` is built
 * from the actual order in hand.
 */

export interface RetentionPlan {
  stance: RetentionStance;
  /**
   * Instruction for the LLM describing what this turn must accomplish. The model
   * phrases it in the caller's language; it does not choose the stance.
   */
  guidance: string;
  /** Attempt number, for the transcript and analytics. */
  attempt: number;
}

/**
 * Decide how to answer a request for a human.
 *
 * `HAND_OVER` is returned once the caller has asked `humanRequestsBeforeHandover`
 * times (default 3), or twice having explicitly rejected AI help — someone who
 * says "you're useless, get me a person" twice is not going to be persuaded by a
 * third attempt, and pretending otherwise is its own kind of bad service.
 */
export function planRetention(
  state: ConversationState,
  policy: PolicyConfig,
  order: Order | null,
): RetentionPlan {
  const asks = state.humanRequestCount;

  const handOver =
    asks >= policy.humanRequestsBeforeHandover ||
    (state.refusedAiHelp && asks >= 2);

  if (handOver) {
    return {
      stance: "HAND_OVER",
      guidance:
        "Stop trying to retain the caller. Tell them plainly that you are connecting them to a " +
        "colleague now, that the details already gathered are being passed across so they will " +
        "not have to repeat themselves, and ask them to stay on the line. Do not ask another " +
        "question. Do not claim the colleague has joined yet.",
      attempt: asks,
    };
  }

  if (asks <= 1) {
    return {
      stance: "OFFER_SELF_SERVE",
      guidance:
        "Do not hand over yet, and do not argue. Acknowledge the request in one short clause, " +
        `then say specifically what you can do right now: ${capability(state, order)}. ` +
        "End by asking whether they would like you to go ahead. Keep it to two sentences.",
      attempt: asks,
    };
  }

  return {
    stance: "SECOND_ATTEMPT",
    guidance:
      "This is the second request, so acknowledge the frustration briefly and genuinely — do not " +
      `repeat your earlier offer word for word. State the concrete outcome you can reach: ` +
      `${capability(state, order)}. Ask for one chance to finish it. Make clear that a colleague ` +
      "is available if they would still rather, so they do not feel trapped. Two sentences.",
    attempt: asks,
  };
}

/**
 * What the AI can honestly offer at this moment.
 *
 * Deliberately specific: naming the order and its real status is far more
 * persuasive than a generic "I can help", and it also keeps the model honest,
 * because it can only promise what the lookup actually returned.
 */
function capability(state: ConversationState, order: Order | null): string {
  if (order) {
    const item = order.items[0]?.name ?? "the item";
    switch (order.status) {
      case "OUT_FOR_DELIVERY":
        return `tell them exactly where order ${order.id} (${item}) is — it is out for delivery today — and give the courier and tracking reference`;
      case "DELAYED":
        return `explain why order ${order.id} (${item}) is delayed, give the revised delivery date, and log a delay complaint that gets it prioritised`;
      case "IN_TRANSIT":
      case "SHIPPED":
        return `give the live tracking status and expected delivery date for order ${order.id} (${item})`;
      case "DELIVERY_FAILED":
        return `check why delivery of order ${order.id} failed and arrange a fresh delivery attempt`;
      case "PLACED":
      case "PACKED":
        return `check order ${order.id} (${item}) and, if they want, cancel it right now without waiting for anyone`;
      case "DELIVERED":
        return `confirm the delivery details for order ${order.id} (${item}) and tell them exactly what their return options are`;
      default:
        return `give them the current status of order ${order.id} (${item}) and their options`;
    }
  }

  if (state.verification.orderId && !state.verification.confirmed) {
    return "look the order up and read the details back to them the moment they confirm the order number";
  }

  return "find their order and give them its live status straight away, as soon as they give you the order number";
}

/**
 * Whether a request for a human should short-circuit the normal question flow.
 *
 * True while the ladder is still persuading: the retention turn replaces the
 * next field question, because continuing to interrogate someone who just asked
 * for a person is the fastest way to lose them.
 */
export function shouldInterruptForRetention(plan: RetentionPlan): boolean {
  return plan.stance !== "HAND_OVER";
}
