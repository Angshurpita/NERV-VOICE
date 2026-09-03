import type { FieldDefinition, FieldKey, IntentKey, Priority } from './types.js';

/**
 * Field registry and per-intent requirements.
 *
 * Question order is a property of this table, not of the model's mood. The LLM
 * phrases the question; `nextQuestion()` decides which field is asked, and never
 * asks for something already confirmed.
 *
 * Requirement 7: `orderId` is P0 and critical for **every** order-related
 * intent, so no intent below can proceed without one.
 */

export const FIELD_DEFINITIONS: Record<FieldKey, FieldDefinition> = {
  orderId: {
    key: 'orderId',
    priority: 'P0',
    critical: true,
    questionIntent:
      'Ask the caller for their order number. It is mandatory — nothing can be checked without it.',
  },
  customerIdentity: {
    key: 'customerIdentity',
    priority: 'P0',
    critical: true,
    questionIntent: 'Ask for the name the order was placed under.',
  },
  problem: {
    key: 'problem',
    priority: 'P1',
    critical: false,
    questionIntent: 'Ask the caller to describe what has gone wrong.',
  },
  cancellationReason: {
    key: 'cancellationReason',
    priority: 'P1',
    critical: false,
    questionIntent: 'Ask why the caller wants to cancel.',
  },
  returnReason: {
    key: 'returnReason',
    priority: 'P1',
    critical: false,
    questionIntent: 'Ask what is wrong with the item they want to return.',
  },
  refundReason: {
    key: 'refundReason',
    priority: 'P1',
    critical: false,
    questionIntent: 'Ask why they are asking for a refund.',
  },
  additionalContext: {
    key: 'additionalContext',
    priority: 'P2',
    critical: false,
    questionIntent: 'Ask whether there is anything else worth knowing.',
  },
};

/**
 * Which fields each intent needs before the AI can act.
 *
 * `orderId` leads every order-related list. `general_query` is the only intent
 * that does not demand one, because it covers questions with no order attached
 * ("what is your return policy?").
 */
export const INTENT_REQUIREMENTS: Record<IntentKey, readonly FieldKey[]> = {
  order_status: ['orderId', 'customerIdentity'],
  delivery_complaint: ['orderId', 'customerIdentity', 'problem'],
  cancellation_request: ['orderId', 'customerIdentity', 'cancellationReason'],
  return_request: ['orderId', 'customerIdentity', 'returnReason'],
  refund_request: ['orderId', 'customerIdentity', 'refundReason'],
  address_change: ['orderId', 'customerIdentity'],
  general_query: ['problem'],
  /** Nothing is demanded until the intent is actually known. */
  unknown: ['problem'],
};

/** Intents that concern a specific order, and so cannot bypass verification. */
const ORDER_SCOPED: ReadonlySet<IntentKey> = new Set<IntentKey>([
  'order_status',
  'delivery_complaint',
  'cancellation_request',
  'return_request',
  'refund_request',
  'address_change',
]);

export function isOrderScoped(intent: IntentKey): boolean {
  return ORDER_SCOPED.has(intent);
}

const PRIORITY_ORDER: readonly Priority[] = ['P0', 'P1', 'P2'];

export function priorityRank(priority: Priority): number {
  return PRIORITY_ORDER.indexOf(priority);
}

export function requiredFieldsFor(intent: IntentKey): readonly FieldKey[] {
  return INTENT_REQUIREMENTS[intent] ?? INTENT_REQUIREMENTS.unknown;
}

/**
 * Required fields for an intent, ordered P0 → P1 → P2. Ties keep the order
 * declared in `INTENT_REQUIREMENTS`, so the sequence is fully deterministic.
 */
export function orderedRequiredFields(intent: IntentKey): readonly FieldKey[] {
  const declared = requiredFieldsFor(intent);
  return [...declared].sort((a, b) => {
    const byPriority =
      priorityRank(FIELD_DEFINITIONS[a].priority) - priorityRank(FIELD_DEFINITIONS[b].priority);
    if (byPriority !== 0) return byPriority;
    return declared.indexOf(a) - declared.indexOf(b);
  });
}

export function isCritical(field: FieldKey): boolean {
  return FIELD_DEFINITIONS[field].critical;
}

/** The reason field matching an intent, used when building a handover report. */
export function reasonFieldFor(intent: IntentKey): FieldKey | null {
  switch (intent) {
    case 'cancellation_request':
      return 'cancellationReason';
    case 'return_request':
      return 'returnReason';
    case 'refund_request':
      return 'refundReason';
    case 'delivery_complaint':
      return 'problem';
    default:
      return null;
  }
}
