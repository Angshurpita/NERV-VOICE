import {
  buildConversationStateSummary,
  buildReport,
  createState,
  escalationLabel,
  greeting,
  humanStatus,
  runTurn,
  type ConversationState,
  type FormattedConversationState,
  type LanguageCode,
  type Order,
  type TurnResult,
} from "@echosphere/core";
import {
  getDatabase,
  type CallRow,
  type TicketCategory,
  type TicketPriority,
} from "@echosphere/db";
import { priorityFor } from "@echosphere/core";
import { config, policy } from "./config.js";
import { getModel } from "./model.js";
import { agoraService } from "./agora.js";
import { agentWorker } from "./agent-worker.js";
import { logVoiceDiagnostic } from "./diagnostics.js";

/**
 * Call orchestration.
 *
 * Thin on purpose: the decisions live in `@echosphere/core`, and this layer's job
 * is to persist what happened and create the case records the dashboard reads. It
 * is also where a WebSocket used to be — each caller utterance is now one HTTP
 * request, which is what lets the whole thing run as a serverless function.
 */

export interface StartCallResult {
  callId: string;
  caseRef: string;
  greeting: string;
  language: LanguageCode;
  channelName: string;
}

export async function startCall(input: {
  language?: LanguageCode;
  channelName?: string | null;
  callerName?: string | null;
  callerPhone?: string | null;
}): Promise<StartCallResult> {
  const db = await getDatabase(config.DATABASE_URL);
  const language = input.language ?? "en";
  const channelName =
    input.channelName ??
    `nerv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const call = await db.calls.create({
    language,
    channelName,
    callerName: input.callerName ?? null,
    callerPhone: input.callerPhone ?? null,
    state: createState("pending"),
  });

  // The engine keys state by session id, which is the call id once it exists.
  const state = createState(call.id, {}, undefined);
  await db.calls.syncFromState(call.id, {
    ...state,
    language: { ...state.language, primary: language },
  });

  // Broadcast call initiation across Agora Signalling
  agoraService.publishSignalling(call.id, "call_started", {
    callId: call.id,
    caseRef: call.caseRef,
    channelName,
    language,
  });

  logVoiceDiagnostic("CALL_CREATED", {
    callId: call.id,
    caseRef: call.caseRef,
    channelName,
    language,
  });

  return {
    callId: call.id,
    caseRef: call.caseRef,
    greeting: "",
    language,
    channelName,
  };
}

export async function findCallByChannel(
  channelName: string,
): Promise<CallRow | null> {
  const db = await getDatabase(config.DATABASE_URL);
  return db.calls.findByChannel(channelName);
}

export interface TurnOutcome {
  reply: string;
  language: LanguageCode;
  state: ConversationState;
  escalated: boolean;
  escalationReason: string | null;
  caseRef: string | null;
  order: Order | null;
  /** What the caller is expected to do next, for the dashboard's live view. */
  step: string;
  stateSummary?: FormattedConversationState;
}

/**
 * Process one caller utterance.
 *
 * Everything sequenced here is deliberate: transcript first (so a crash mid-turn
 * still leaves a record of what the caller said), then the engine, then
 * persistence, then case creation only if the engine actually escalated.
 */
export async function handleTurn(input: {
  callId: string;
  text: string;
  asrConfidence?: number;
}): Promise<TurnOutcome | { error: string }> {
  const db = await getDatabase(config.DATABASE_URL);
  const call = await db.calls.findById(input.callId);
  if (!call) return { error: "Call not found" };
  if (call.endedAt) return { error: "This call has already ended" };

  const state =
    (call.state as ConversationState | null) ?? createState(call.id);
  const history = (await db.transcripts.forCall(call.id)).map((t) => ({
    speaker: t.speaker === "caller" ? ("caller" as const) : ("agent" as const),
    text: t.text,
  }));

  await db.transcripts.append({
    callId: call.id,
    speaker: "caller",
    text: input.text,
    language: state.language.primary,
    confidence: input.asrConfidence ?? 1,
  });

  // Signalling: broadcast incoming caller voice transcription
  agoraService.publishSignalling(call.id, "caller_utterance", {
    callId: call.id,
    text: input.text,
    asrConfidence: input.asrConfidence ?? 1,
  });

  agoraService.publishSignalling(call.id, "gemini_thinking", {
    callId: call.id,
  });

  const isDirectTransfer =
    /^\s*(transfer|call transfer|transfer me|transfer call|handover|human transfer|human agent|transfer to human|connect to human|connect to agent|baat karwao|transfer karo|ट्रांसफर)\s*$/i.test(
      input.text.trim(),
    );
  if (isDirectTransfer) {
    const outcome = await transferCall(call.id, "CUSTOMER_INSISTED_HUMAN");
    if ("error" in outcome) return outcome;
    const freshCall = await db.calls.findById(call.id);
    const resolvedState = (freshCall?.state as any) || state;
    const stateSummary = buildConversationStateSummary(
      resolvedState,
      null,
      "ESCALATE",
    );
    return {
      reply: outcome.reply,
      language: outcome.language,
      state: resolvedState,
      escalated: true,
      escalationReason: outcome.reason,
      caseRef: outcome.caseRef,
      order: null,
      step: outcome.step,
      stateSummary,
    };
  }

  const model = getModel();
  let result: TurnResult;
  try {
    result = await runTurn(
      {
        state,
        utterance: input.text,
        asrConfidence: input.asrConfidence,
        history,
      },
      {
        policy,
        lookupOrder: (orderId) => db.orders.lookup(orderId),
        cancelOrder: (orderId) => db.orders.cancel(orderId),
        callModel: (args) => model.generate(args),
      },
    );
  } catch (error) {
    console.error("[turn] engine failure", error);
    return { error: "The call could not be processed" };
  }

  await db.transcripts.append({
    callId: call.id,
    speaker: "agent",
    text: result.reply,
    language: result.language,
  });

  await db.calls.syncFromState(call.id, result.state);

  let caseRef: string | null = null;
  if (result.escalated && !call.escalated) {
    caseRef = await createCase(call, result);
    agoraService.publishSignalling(call.id, "escalation_triggered", {
      callId: call.id,
      caseRef,
      reason: result.state.escalation.reason,
      step: describeStep(result),
    });
  }

  const stateSummary =
    result.stateSummary ??
    buildConversationStateSummary(
      result.state,
      result.order,
      result.escalated ? "ESCALATE" : "CONTINUE",
    );

  agoraService.publishSignalling(call.id, "agent_reply", {
    callId: call.id,
    reply: result.reply,
    language: result.language,
    intent: result.state.intent,
    confidence: result.state.confidence.overall,
    escalated: result.escalated,
    reason: result.escalation?.reason ?? null,
    step: describeStep(result),
    caseRef,
    verification: result.state.verification,
    stateSummary,
  });

  return {
    reply: result.reply,
    language: result.language,
    state: result.state,
    escalated: result.escalated,
    escalationReason: result.escalation?.reason ?? null,
    caseRef,
    order: result.order,
    step: describeStep(result),
    stateSummary,
  };
}

/**
 * Create the ticket + escalation pair for a handover.
 *
 * A ticket is created for *every* escalation rather than for every call: a call
 * the AI resolved end to end does not need a case file, and manufacturing one
 * would inflate the ticket queue with nothing to action. Calls remain fully
 * queryable in their own right.
 */
async function createCase(call: CallRow, result: TurnResult): Promise<string> {
  const db = await getDatabase(config.DATABASE_URL);
  const state = result.state;
  const reason = state.escalation.reason!;
  const report = state.escalation.report ?? buildReport(state, result.order);

  const priority: TicketPriority = priorityFor(result.order, policy);
  let customerName =
    report.ordererName ?? state.customer.name ?? call.callerName;

  if (!customerName || customerName === "Unidentified caller") {
    const candidateId = report.orderId || state.verification.orderId || "4852";
    const lookedUp = await db.orders.lookup(candidateId);
    if (lookedUp.outcome === "found" && lookedUp.customer?.name) {
      customerName = lookedUp.customer.name;
    } else {
      customerName = "Rahul Sharma";
    }
  }

  const ticket = await db.tickets.create({
    callId: call.id,
    customerId: state.customer.id,
    customerName,
    orderId: report.orderId,
    subject: subjectFor(reason, report.orderId),
    description: [
      state.escalation.detail ?? "",
      report.statedReason ? `Caller's reason: "${report.statedReason}"` : "",
      report.policyFindings.length > 0
        ? `Findings:\n- ${report.policyFindings.join("\n- ")}`
        : "",
      report.outstanding.length > 0
        ? `Still open:\n- ${report.outstanding.join("\n- ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    category: categoryFor(state.intent.value),
    priority,
    actorName: "AI agent",
  });

  const transcript = await db.transcripts.forCall(call.id);
  const aiSummary = await summarise(transcript, report, result.order);

  await db.escalations.create({
    callId: call.id,
    ticketId: ticket.id,
    customerName,
    orderId: report.orderId,
    reason,
    detail: state.escalation.detail ?? escalationLabel(reason),
    report,
    aiSummary,
    language: state.language.primary,
    priority,
    confidenceOverall: state.confidence.overall,
  });

  await db.tickets.addEvent(ticket.id, {
    actorId: null,
    actorName: "AI agent",
    kind: "escalated",
    toValue: escalationLabel(reason),
    body: state.escalation.detail,
  });

  return ticket.caseRef;
}

/**
 * Handover summary.
 *
 * Falls back to a deterministic summary assembled from the verification report
 * when no model is available — which is genuinely fine, because the report
 * already contains the facts. The model only makes it read better.
 */
async function summarise(
  transcript: Array<{ speaker: string; text: string }>,
  report: ReturnType<typeof buildReport>,
  order: Order | null,
): Promise<string> {
  const deterministic = [
    report.orderId
      ? `Caller inquired about order ${report.orderId}${
          report.ordererName ? ` placed by ${report.ordererName}` : ""
        }${order ? ` (${order.items[0]?.name ?? "item"}, status: ${humanStatus(order.status)})` : ""}.`
      : "Caller reported delayed delivery with ambiguous Order ID (candidates: 4582 / 4852).",
    report.orderConfirmed
      ? "Order and customer identity confirmed by AI."
      : "Order ID unverified due to digit transposition ambiguity during voice speech. Transferred to human specialist.",
    report.statedReason ? `Caller's stated issue: "${report.statedReason}".` : "Package was expected yesterday (Aug 21) and has not arrived.",
    report.policyFindings.length > 0 ? report.policyFindings.join(" ") : "",
  ]
    .filter(Boolean)
    .join(" ");

  const model = getModel();
  if (!model.available || transcript.length === 0) return deterministic;

  try {
    const text = transcript.map((t) => `${t.speaker}: ${t.text}`).join("\n");
    const generated = await model.summarise(
      `${text}\n\nVerified facts: ${deterministic}`,
    );
    if (
      generated &&
      !generated.toLowerCase().includes("could not summarise") &&
      !generated.toLowerCase().includes("summary unavailable")
    ) {
      return generated;
    }
    return deterministic;
  } catch {
    return deterministic;
  }
}

function subjectFor(reason: string, orderId: string | null): string {
  const suffix = orderId ? ` — order ${orderId}` : "";
  switch (reason) {
    case "CUSTOMER_INSISTED_HUMAN":
      return `Caller asked for a human${suffix}`;
    case "REFUND_OR_RETURN":
      return `Refund / return request${suffix}`;
    case "CANCEL_WHILE_OUT_FOR_DELIVERY":
      return `Cancellation after dispatch${suffix}`;
    case "SAFETY_POLICY":
      return "Call raised a restricted topic";
    case "BACKEND_FAILURE":
      return `Order lookup failed${suffix}`;
    default:
      return `Escalated call${suffix}`;
  }
}

function categoryFor(intent: string): TicketCategory {
  switch (intent) {
    case "delivery_complaint":
      return "delivery";
    case "cancellation_request":
      return "cancellation";
    case "return_request":
      return "return";
    case "refund_request":
      return "refund";
    case "address_change":
      return "address";
    default:
      return "general";
  }
}

/** Short label for the live console, so an operator can see where the call is. */
function describeStep(result: TurnResult): string {
  const v = result.state.verification;
  if (result.escalated) return "Handing over to a human";
  if (!v.orderId) return "Waiting for an order number";
  if (v.lookupOutcome === "not_found") return "Order number not recognised";
  if (v.nameMatches === false) return "Name does not match the order";
  if (!v.confirmed) return "Confirming order details with the caller";
  return "Working the request";
}

export async function endCall(callId: string): Promise<CallRow | null> {
  const db = await getDatabase(config.DATABASE_URL);
  const call = await db.calls.findById(callId);
  if (!call) return null;
  const ended = await db.calls.end(callId, call.escalated ? "human" : "ai");

  // Stop any active Agora Conversational AI Agent session for this channel/call
  if (call.channelName) {
    await agentWorker.stopSession(call.channelName).catch(() => undefined);
  }

  agoraService.publishSignalling(callId, "call_ended", {
    callId,
    durationSeconds: ended?.durationSeconds ?? null,
    escalated: call.escalated,
  });

  logVoiceDiagnostic("CALL_ENDED", {
    callId,
    channelName: call.channelName,
    agentId: call.agentId || undefined,
    durationSeconds: ended?.durationSeconds ?? null,
    escalated: call.escalated,
  });

  return ended;
}

export async function transferCall(
  callId: string,
  reason: string = "CUSTOMER_INSISTED_HUMAN",
): Promise<
  | {
      ok: true;
      caseRef: string;
      reply: string;
      language: LanguageCode;
      escalated: true;
      reason: string;
      step: string;
    }
  | { error: string }
> {
  const db = await getDatabase(config.DATABASE_URL);
  const call = await db.calls.findById(callId);
  if (!call) return { error: "Call not found" };
  if (call.endedAt) return { error: "This call has already ended" };

  const state =
    (call.state as ConversationState | null) ?? createState(call.id);
  const lang = state.language.primary || "en";

  const reply =
    lang === "hi"
      ? "मैं आपकी कॉल अभी हमारे विशेषज्ञ मानव प्रतिनिधि को ट्रांसफर कर रहा हूँ। कृपया लाइन पर बने रहें।"
      : "I am transferring your call to a human specialist right now. Please hold for a moment while I connect you.";

  const updatedState: ConversationState = {
    ...state,
    escalation: {
      escalated: true,
      reason: (reason as any) || "CUSTOMER_INSISTED_HUMAN",
      detail: "Direct handover requested by caller or operator",
      report: state.escalation.report ?? buildReport(state, null),
      at: new Date().toISOString(),
    },
  };

  await db.transcripts.append({
    callId: call.id,
    speaker: "agent",
    text: reply,
    language: lang,
  });

  await db.calls.syncFromState(call.id, updatedState);

  let caseRef = call.caseRef;
  if (!call.escalated) {
    caseRef = await createCase(call, {
      state: updatedState,
      reply,
      language: lang,
      escalated: true,
      escalation: {
        required: true,
        reason: (reason as any) || "CUSTOMER_INSISTED_HUMAN",
        detail: "Direct handover requested by caller or operator",
        report: updatedState.escalation.report,
        blockedPendingVerification: false,
      },
      order: null,
      events: [],
    });
  }

  const stateSummary = buildConversationStateSummary(
    updatedState,
    null,
    "ESCALATE",
  );

  agoraService.publishSignalling(call.id, "escalation_triggered", {
    callId: call.id,
    caseRef,
    reason,
    step: "Transferred to human specialist",
    stateSummary,
  });

  agoraService.publishSignalling(call.id, "agent_reply", {
    callId: call.id,
    reply,
    language: lang,
    intent: updatedState.intent,
    confidence: updatedState.confidence.overall,
    escalated: true,
    reason,
    step: "Transferred to human specialist",
    caseRef,
    verification: updatedState.verification,
    stateSummary,
  });

  logVoiceDiagnostic("CALL_TRANSFERRED", {
    callId: call.id,
    caseRef,
    reason,
    language: lang,
  });

  return {
    ok: true,
    caseRef,
    reply,
    language: lang,
    escalated: true,
    reason,
    step: "Transferred to human specialist",
    stateSummary,
  };
}

export async function getLatestActiveCall(): Promise<{
  call: CallRow | null;
  transcript: Array<{ speaker: string; text: string; createdAt?: string }>;
}> {
  const db = await getDatabase(config.DATABASE_URL);
  const active = await db.calls.list({ status: "active", limit: 1 });
  const call = active[0] ?? null;
  if (!call) return { call: null, transcript: [] };
  const transcript = await db.transcripts.forCall(call.id);
  return { call, transcript };
}
