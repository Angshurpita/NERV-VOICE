/**
 * Domain types.
 *
 * These structures are owned by the backend, never by the model. Gemini may
 * *propose* values (via tool calls); only the code in this package decides what
 * is recorded, what counts as confirmed, and when a call leaves the AI.
 */

// ── Language ──────────────────────────────────────────────────────────────────

export type LanguageCode = "hi" | "en";

export interface LanguageState {
  /** Language the caller is currently speaking. */
  primary: LanguageCode;
  /** Other language observed in this conversation, if any. */
  secondary: LanguageCode | null;
  /** True once both languages have been observed. */
  codeSwitched: boolean;
  /** Number of observed switches, for analytics. */
  switchCount: number;
}

// ── Commerce ──────────────────────────────────────────────────────────────────

/**
 * The full order lifecycle. Kept wide on purpose: the escalation and
 * cancellation rules key off specific late-stage statuses, so collapsing these
 * into "shipped / not shipped" would erase the distinction requirement 6.3
 * depends on.
 */
export type OrderStatus =
  | "PLACED"
  | "PACKED"
  | "SHIPPED"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "DELAYED"
  | "CANCELLED"
  | "RETURN_REQUESTED"
  | "RETURN_PICKED_UP"
  | "RETURNED"
  | "REFUND_PENDING"
  | "REFUNDED"
  | "LOST_IN_TRANSIT"
  | "DELIVERY_FAILED"
  | "RTO";

export type PaymentMethod =
  "PREPAID_CARD" | "UPI" | "NET_BANKING" | "COD" | "EMI" | "WALLET";

/** Return policy class for a product category. */
export type ReturnPolicyClass =
  /** Returnable for a refund within the window. */
  | "RETURNABLE"
  /** Defect-only exchange, no refund (e.g. large appliances). */
  | "REPLACEMENT_ONLY"
  /** Never returnable (innerwear, perishables, gift cards). */
  | "NON_RETURNABLE";

export interface OrderItem {
  sku: string;
  name: string;
  category: string;
  quantity: number;
  unitPriceInr: number;
  returnPolicy: ReturnPolicyClass;
}

export interface OrderEvent {
  status: OrderStatus;
  at: string;
  note: string | null;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  /** Last four digits, used for low-friction verification over voice. */
  phoneLast4: string;
  city: string;
  preferredLanguage: LanguageCode;
}

export interface Order {
  id: string;
  customerId: string;
  status: OrderStatus;
  items: OrderItem[];
  totalInr: number;
  paymentMethod: PaymentMethod;
  placedAt: string;
  expectedDeliveryAt: string;
  deliveredAt: string | null;
  cancelledAt: string | null;
  refundedAt: string | null;
  courier: string | null;
  trackingId: string | null;
  deliveryAddress: string;
  city: string;
  /** Days after delivery during which a return may be raised. */
  returnWindowDays: number;
  /** Count of failed delivery attempts so far. */
  failedDeliveryAttempts: number;
  history: OrderEvent[];
}

export type OrderLookupResult =
  | { outcome: "found"; order: Order; customer: Customer }
  | { outcome: "not_found"; orderId: string }
  | { outcome: "backend_unavailable"; orderId: string };

// ── Fields ────────────────────────────────────────────────────────────────────

export type FieldKey =
  | "orderId"
  | "customerIdentity"
  | "problem"
  | "cancellationReason"
  | "returnReason"
  | "refundReason"
  | "additionalContext";

/** P0 is asked before P1, P1 before P2. */
export type Priority = "P0" | "P1" | "P2";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

/**
 * One candidate value heard for a field. Retained even after being superseded,
 * so `"4582... no, 4852"` stays visible as a genuine ambiguity instead of
 * collapsing into a single confident-looking answer.
 */
export interface Candidate {
  value: string;
  /** Confidence at the moment it was heard (ASR × extraction). */
  confidence: number;
  observedAt: string;
  /** Verbatim caller utterance this came from, for the audit trail. */
  sourceUtterance: string;
}

export interface FieldState {
  /**
   * Settled value. Stays null while candidates conflict — a field is never
   * given a value the system has not actually resolved.
   */
  value: string | null;
  candidates: Candidate[];
  confidence: number;
  /** True only after the caller explicitly agreed to a read-back. */
  confirmed: boolean;
  /** Human-facing rendering: `"4582 / 4852"` while ambiguous. */
  display: string | null;
}

export interface FieldDefinition {
  key: FieldKey;
  priority: Priority;
  /** Critical fields must be read back and confirmed before they are trusted. */
  critical: boolean;
  /** Overrides the global HIGH threshold for this field. */
  confirmationThreshold?: number;
  /** Asked in the caller's language by the LLM; this is the intent of the ask. */
  questionIntent: string;
}

// ── Intent ────────────────────────────────────────────────────────────────────

export type IntentKey =
  | "order_status"
  | "delivery_complaint"
  | "cancellation_request"
  | "return_request"
  | "refund_request"
  | "address_change"
  | "general_query"
  | "unknown";

export interface IntentState {
  value: IntentKey;
  confidence: number;
}

// ── Order verification (requirement 7) ────────────────────────────────────────

/**
 * The order-ID gate. Every order-specific action is blocked until this reaches
 * `confirmed`, and the gate lives in code rather than in prompt wording so a
 * model that "forgets" cannot skip it.
 */
export interface VerificationState {
  /** Order id the caller settled on. */
  orderId: string | null;
  /** True once the order service has been queried for that id. */
  lookedUp: boolean;
  /** Outcome of that lookup. */
  lookupOutcome: "found" | "not_found" | "backend_unavailable" | null;
  /** Name on the order, from the database — never from the caller. */
  ordererName: string | null;
  /** True once the AI has read the order details back to the caller. */
  readBack: boolean;
  /** True once the caller explicitly agreed the details are theirs. */
  confirmed: boolean;
  /**
   * Whether the name the caller gave matches the name on the order. Null until
   * a name has been heard. False withholds order details rather than disclosing
   * another customer's purchase.
   */
  nameMatches: boolean | null;
  /** Failed verification rounds, for the audit trail. */
  attempts: number;
}

// ── Escalation (requirement 6) ────────────────────────────────────────────────

/**
 * Escalation reasons, deliberately few.
 *
 * The first three are the only business reasons a call may leave the AI. The
 * last two are floors, not judgement calls: `SAFETY_POLICY` covers domains an
 * AI must not counsel at all, and `BACKEND_FAILURE` covers the case where the
 * AI has no truthful answer available because the order service is down.
 */
export type EscalationReason =
  | "CUSTOMER_INSISTED_HUMAN"
  | "REFUND_OR_RETURN"
  | "CANCEL_WHILE_OUT_FOR_DELIVERY"
  | "SAFETY_POLICY"
  | "BACKEND_FAILURE";

/**
 * What the AI established before handing over. Requirement 6.2 asks for "proper
 * reason verification from your end" — this is that report, and it travels with
 * the case so the human does not restart the conversation.
 */
export interface VerificationReport {
  orderId: string | null;
  ordererName: string | null;
  orderStatus: OrderStatus | null;
  orderTotalInr: number | null;
  identityConfirmed: boolean;
  orderConfirmed: boolean;
  /** Caller's stated reason, verbatim. */
  statedReason: string | null;
  /** Deterministic policy findings, e.g. "Return window closed 12 days ago". */
  policyFindings: string[];
  /** What the AI could not establish, so the human knows where to pick up. */
  outstanding: string[];
}

export interface EscalationState {
  required: boolean;
  reason: EscalationReason | null;
  /** Operator-readable explanation shown on the agent dashboard. */
  detail: string | null;
  report: VerificationReport | null;
  triggeredAt: string | null;
}

// ── Retention (requirement 6.1) ───────────────────────────────────────────────

/**
 * How the AI should respond to a request for a human. Escalating on the first
 * ask is what the old implementation did; this ladder is why it no longer does.
 */
export type RetentionStance =
  /** First ask — acknowledge, then offer the concrete thing it can do now. */
  | "OFFER_SELF_SERVE"
  /** Second ask — empathise, name the outcome, ask for one chance. */
  | "SECOND_ATTEMPT"
  /** Third ask, or a hard refusal — stop persuading. */
  | "HAND_OVER";

// ── Conversation state ────────────────────────────────────────────────────────

export type AgentPhase =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "escalating"
  | "human_active"
  | "ended";

export interface CustomerState {
  /** Populated from a database lookup, never from the model. */
  id: string | null;
  name: string | null;
  identityVerified: boolean;
}

export interface ConversationState {
  sessionId: string;
  /** Agora channel carrying the call, when one is in use. */
  channelName: string | null;
  phase: AgentPhase;
  customer: CustomerState;
  intent: IntentState;
  language: LanguageState;
  verification: VerificationState;
  requiredInformation: Partial<Record<FieldKey, FieldState>>;
  /** Times the system has asked for each field. */
  attempts: Partial<Record<FieldKey, number>>;
  confidence: { overall: number };
  escalation: EscalationState;
  /** Field currently awaiting a yes/no answer to a read-back. */
  pendingConfirmation: FieldKey | null;
  /**
   * How many times the caller has asked for a human. Drives the retention
   * ladder; escalation needs this at 3.
   */
  humanRequestCount: number;
  /** True once the caller has explicitly rejected an offer of AI help. */
  refusedAiHelp: boolean;
  /** Actions the backend actually executed, for outbound response screening. */
  executedActions: string[];
  /** Order statuses returned by real lookups this session. */
  knownOrderStatuses: Record<string, OrderStatus>;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
}

// ── Events ────────────────────────────────────────────────────────────────────

export type EventType =
  | "CALL_STARTED"
  | "CALL_ENDED"
  | "TRANSCRIPT_FINAL"
  | "LANGUAGE_CHANGED"
  | "ENTITY_DETECTED"
  | "ENTITY_CONFIRMED"
  | "ORDER_VERIFIED"
  | "ORDER_VERIFICATION_FAILED"
  | "RETENTION_ATTEMPTED"
  | "CONFIDENCE_CHANGED"
  | "QUESTION_ASKED"
  | "ESCALATION_TRIGGERED"
  | "CASE_CREATED"
  | "HUMAN_AGENT_ACCEPTED"
  | "CASE_RESOLVED"
  | "SAFETY_BLOCKED"
  | "TOOL_EXECUTED"
  | "TOOL_DENIED"
  | "RESPONSE_REWRITTEN";

export interface ConversationEvent<P = unknown> {
  type: EventType;
  sessionId: string;
  at: string;
  payload: P;
}
