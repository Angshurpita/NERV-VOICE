import { DEFAULT_POLICY, withPolicy } from "../config.js";
import { createState, observeField } from "../conversation-state.js";
import {
  applyLookup,
  applyNameCheck,
  applyOrderConfirmation,
  markReadBack,
} from "../verification.js";
import type { Clock } from "../conversation-state.js";
import type {
  ConversationState,
  Customer,
  IntentKey,
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  ReturnPolicyClass,
} from "../types.js";

/** Frozen clock, so every timestamp in a test is predictable. */
export const FIXED_NOW = new Date("2026-09-03T10:00:00.000Z");
export const fixedClock: Clock = { now: () => FIXED_NOW };

export const policy = withPolicy();

export function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: "cust_001",
    name: "Rahul Sharma",
    email: "rahul.sharma@example.com",
    phone: "+919876543210",
    phoneLast4: "3210",
    city: "Mumbai",
    preferredLanguage: "hi",
    ...over,
  };
}

export function makeItem(over: Partial<OrderItem> = {}): OrderItem {
  return {
    sku: "SKU-HEADPHONE-01",
    name: "Sony WH-1000XM5 Headphones",
    category: "Audio",
    quantity: 1,
    unitPriceInr: 29990,
    returnPolicy: "RETURNABLE" as ReturnPolicyClass,
    ...over,
  };
}

export function makeOrder(over: Partial<Order> = {}): Order {
  const items = over.items ?? [makeItem()];
  return {
    id: "4852",
    customerId: "cust_001",
    status: "DELAYED" as OrderStatus,
    items,
    totalInr: items.reduce((s, i) => s + i.unitPriceInr * i.quantity, 0),
    paymentMethod: "PREPAID_CARD" as PaymentMethod,
    placedAt: "2026-08-17",
    expectedDeliveryAt: "2026-08-21",
    deliveredAt: null,
    cancelledAt: null,
    refundedAt: null,
    courier: "Delhivery",
    trackingId: "DL77392211",
    deliveryAddress: "Flat 4B, Green View, Andheri West, Mumbai 400053",
    city: "Mumbai",
    returnWindowDays: 10,
    failedDeliveryAttempts: 0,
    history: [{ status: "PLACED", at: "2026-08-17", note: null }],
    ...over,
  };
}

/**
 * A conversation that has cleared the requirement-7 gate.
 *
 * Most escalation tests need a *verified* call, because requirement 6.2 makes
 * verification a precondition of handover — so building this by hand in every
 * test would bury the assertion.
 */
export function verifiedState(
  intent: IntentKey,
  order: Order,
  customer: Customer = makeCustomer(),
): ConversationState {
  let state = createState("sess_test", {}, fixedClock);
  state = { ...state, intent: { value: intent, confidence: 0.92 } };

  state = observeField(
    state,
    "orderId",
    order.id,
    0.95,
    `it's ${order.id}`,
    fixedClock,
  );
  state = applyLookup(state, { outcome: "found", order, customer }, fixedClock);
  state = observeField(
    state,
    "customerIdentity",
    customer.name,
    0.93,
    customer.name,
    fixedClock,
  );
  state = applyNameCheck(state, customer.name, customer.name, fixedClock);
  state = markReadBack(state, fixedClock);
  state = applyOrderConfirmation(state, true, fixedClock);

  return state;
}

/** A call where nothing has been verified yet. */
export function freshState(intent: IntentKey = "unknown"): ConversationState {
  const state = createState("sess_test", {}, fixedClock);
  return intent === "unknown"
    ? state
    : { ...state, intent: { value: intent, confidence: 0.9 } };
}

export const NO_HINTS = { cancel: false, return_: false, refund: false };

export { DEFAULT_POLICY };
