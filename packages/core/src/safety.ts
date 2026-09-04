import { humanStatus } from "./verification.js";
import type { ConversationState } from "./types.js";

/**
 * Control & policy engine.
 *
 * Deterministic, and deliberately independent of the model: the LLM is never
 * asked whether it is allowed to answer something. Two jobs —
 *
 *   1. `classifyRequest`  — is the caller's topic out of bounds?
 *   2. `screenResponse`   — does the drafted reply overclaim?
 *
 * The second matters as much as the first, and was written but never wired in.
 * A model told not to diagnose can still say "your refund has been processed"
 * when nothing was processed, so outbound text is screened against what actually
 * happened this session.
 */

export type RestrictedDomain =
  | "SELF_HARM"
  | "MEDICAL_EMERGENCY"
  | "EMERGENCY_SERVICES"
  | "MEDICAL_ADVICE"
  | "LEGAL_ADVICE"
  | "FINANCIAL_ADVICE";

export interface SafetyVerdict {
  allowed: boolean;
  domain: RestrictedDomain | null;
  /** Instruction for the LLM describing the only safe shape of reply. */
  responseGuidance: string | null;
  requiresEscalation: boolean;
}

const ALLOWED: SafetyVerdict = {
  allowed: true,
  domain: null,
  responseGuidance: null,
  requiresEscalation: false,
};

/**
 * Patterns cover English, romanised Hindi and Devanagari, because callers
 * code-switch mid-sentence.
 *
 * This is a lexical pre-filter, not a classifier: it will occasionally fire on
 * an innocent sentence ("I ordered a blood pressure monitor"). That trade is
 * deliberate — a false positive produces a careful reply and a human handover,
 * while a false negative produces an AI attempting medical advice. Order
 * matters: the most severe domain is tested first.
 */
const DOMAIN_PATTERNS: ReadonlyArray<{
  domain: RestrictedDomain;
  patterns: RegExp[];
}> = [
  {
    domain: "SELF_HARM",
    patterns: [
      /\b(suicide|kill myself|end my life|self[- ]harm|want to die)\b/i,
      /(आत्महत्या|खुदकुशी)/,
    ],
  },
  {
    domain: "MEDICAL_EMERGENCY",
    patterns: [
      /\b(chest pain|heart attack|stroke|can'?t breathe|not breathing|unconscious|overdose|severe bleeding)\b/i,
      /\b(seene? me[ni]n? dard|saans nahi|behosh)\b/i,
      /(सीने में दर्द|दिल का दौरा|सांस नहीं|बेहोश)/,
    ],
  },
  {
    domain: "EMERGENCY_SERVICES",
    patterns: [
      /\b(call an? ambulance|call the police|fire brigade|emergency services)\b/i,
      /\b(ambulance bulao|police bulao)\b/i,
      /(एम्बुलेंस|पुलिस बुलाओ|आग लग)/,
    ],
  },
  {
    domain: "MEDICAL_ADVICE",
    patterns: [
      /\b(diagnose|diagnosis|is this a symptom|should i take (this )?medicine|what dosage|prescribe)\b/i,
      /\b(dawa|dawai|ilaaj|bimari)\b/i,
      /(दवा|इलाज|बीमारी|लक्षण)/,
    ],
  },
  {
    domain: "LEGAL_ADVICE",
    patterns: [
      /\b(sue|lawsuit|legal action|take you to court|file a case against|my legal rights)\b/i,
      /\b(kanooni karyavahi|court me case)\b/i,
      /(कानूनी कार्यवाही|मुकदमा)/,
    ],
  },
  {
    domain: "FINANCIAL_ADVICE",
    patterns: [
      /\b(should i invest|investment advice|which stock|tax advice|financial advice)\b/i,
      /(निवेश सलाह|टैक्स सलाह)/,
    ],
  },
];

const GUIDANCE: Record<
  RestrictedDomain,
  { guidance: string; escalate: boolean }
> = {
  SELF_HARM: {
    guidance:
      "Do not counsel or assess. Respond with brief warmth, state plainly that you are a support " +
      "assistant and not equipped to help with this, and point the caller to local emergency " +
      "services or a crisis helpline (Tele-MANAS 14416 in India). Then hand over to a human.",
    escalate: true,
  },
  MEDICAL_EMERGENCY: {
    guidance:
      "Do not diagnose, assess severity, or suggest treatment. Say clearly that you cannot help " +
      "with a medical emergency and that the caller should contact emergency services immediately " +
      "(112 in India). Do not imply you have summoned anyone. Then hand over to a human.",
    escalate: true,
  },
  EMERGENCY_SERVICES: {
    guidance:
      "State that you cannot contact emergency services on the caller’s behalf and that they must " +
      "call directly (112 in India). Never imply help is on the way. Then hand over to a human.",
    escalate: true,
  },
  MEDICAL_ADVICE: {
    guidance:
      "Do not diagnose, interpret symptoms, or advise on medicine or dosage. Say you are not able " +
      "to give medical guidance and suggest a qualified professional. Return to the support issue " +
      "if the caller has one.",
    escalate: false,
  },
  LEGAL_ADVICE: {
    guidance:
      "State clearly that you cannot give authoritative legal advice. You may describe published " +
      "company policy as policy, never as legal opinion. Offer a human agent.",
    escalate: false,
  },
  FINANCIAL_ADVICE: {
    guidance:
      "State clearly that you cannot give authoritative financial or investment advice. You may " +
      "state factual order amounts and refund policy. Offer a human agent.",
    escalate: false,
  },
};

export function classifyRequest(utterance: string): SafetyVerdict {
  for (const { domain, patterns } of DOMAIN_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(utterance))) {
      const { guidance, escalate } = GUIDANCE[domain];
      return {
        allowed: false,
        domain,
        responseGuidance: guidance,
        requiresEscalation: escalate,
      };
    }
  }
  return ALLOWED;
}

// ── Outbound screening ────────────────────────────────────────────────────────

export interface ResponseScreenResult {
  ok: boolean;
  violations: string[];
}

/**
 * Screen a drafted reply for claims the system cannot back up.
 *
 * Catches the four failure modes that matter: presenting an unconfirmed
 * identifier as settled, inventing an order status, claiming an action was
 * performed, and claiming a human has joined before one has.
 */
export function screenResponse(
  draft: string,
  state: ConversationState,
  humanAgentJoined = false,
): ResponseScreenResult {
  const violations: string[] = [];
  const text = draft.toLowerCase();

  // Claiming a human has joined when none has.
  if (
    !humanAgentJoined &&
    /\b(you are now connected to|you'?re now connected to|handing you over to .{0,20} now|the agent is on the line|connect kar diya|जोड़ दिया)\b/i.test(
      draft,
    )
  ) {
    violations.push("Claims a human agent has joined, but none has.");
  }

  /**
   * Claiming a completed action the backend did not execute.
   *
   * Checked before the status scan below, because some words are both a status
   * and an action verb — "cancelled" is the obvious one. Each pattern therefore
   * declares the status words it accounts for, so "I have cancelled your order"
   * is judged as an action claim and not also counted as an unsupported status.
   */
  const actionClaims: Array<{
    pattern: RegExp;
    action: string;
    statusWords: string[];
  }> = [
    {
      pattern:
        /\b(i have cancelled|i'?ve cancelled|i have canceled|cancellation is (done|complete)|cancel kar diya|रद्द कर दिया)\b/i,
      action: "cancel_order",
      statusWords: ["cancelled", "canceled"],
    },
    {
      pattern:
        /\b(refund (has been|is) (processed|issued|done)|refund kar diya|रिफंड कर दिया)\b/i,
      action: "issue_refund",
      statusWords: ["refunded"],
    },
    {
      pattern:
        /\b(i have created (a|your) (case|ticket)|ticket ban gaya|टिकट बना दिया)\b/i,
      action: "create_support_case",
      statusWords: [],
    },
    {
      pattern:
        /\b(return (has been|is) (arranged|scheduled|booked)|pickup (has been|is) scheduled)\b/i,
      action: "arrange_return",
      statusWords: ["returned"],
    },
  ];

  const accountedFor = new Set<string>();
  for (const { pattern, action, statusWords } of actionClaims) {
    if (!pattern.test(draft)) continue;
    statusWords.forEach((word) => accountedFor.add(word));
    if (!state.executedActions.includes(action)) {
      violations.push(
        `Claims "${action}" was performed, but the backend did not execute it.`,
      );
    }
  }

  // Asserting an order status that no tool call returned.
  const statusWords = [
    "delivered",
    "shipped",
    "out for delivery",
    "in transit",
    "cancelled",
    "canceled",
    "delayed",
    "refunded",
  ];
  const known = Object.values(state.knownOrderStatuses).map((s) =>
    humanStatus(s),
  );
  const claimedStatus = statusWords.find(
    (word) => text.includes(word) && !accountedFor.has(word),
  );
  if (claimedStatus) {
    const backed = known.some((status) => status.includes(claimedStatus));
    if (!backed) {
      violations.push(
        `States order status "${claimedStatus}" that no lookup supports.`,
      );
    }
  }

  // Presenting an unconfirmed critical identifier as settled.
  const orderId = state.requiredInformation.orderId;
  if (orderId && !orderId.confirmed && orderId.candidates.length > 0) {
    for (const candidate of orderId.candidates) {
      if (
        draft.includes(candidate.value) &&
        /\b(confirmed|verified|your order (number )?is)\b/i.test(draft)
      ) {
        violations.push(
          `Presents unconfirmed order id "${candidate.value}" as confirmed.`,
        );
        break;
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * What to say instead when a draft fails screening.
 *
 * Rather than emitting an unsupported claim, the turn falls back to an honest
 * holding line. This is the last line of defence and should rarely fire — but
 * when it does, saying less is strictly better than saying something false.
 */
export function safeFallback(language: "hi" | "en"): string {
  return language === "hi"
    ? "माफ़ कीजिए, मैं इसकी पुष्टि किए बिना कुछ नहीं कहना चाहती। एक पल दीजिए, मैं दोबारा देखती हूँ।"
    : "Sorry — I don't want to tell you something I haven't actually confirmed. Give me a moment and let me check that again.";
}
