import type { LanguageCode } from "./types.js";

/**
 * Lexical signal detection.
 *
 * Callers to an Indian support line switch between English, romanised Hindi and
 * Devanagari mid-sentence, often inside a single clause ("bhai mera order kahan
 * hai, can you check"). Every pattern below therefore comes in all three
 * scripts. This is a pre-filter feeding deterministic policy, not a classifier —
 * the LLM still interprets meaning, but policy decisions (escalate / do not
 * escalate) must not depend on the model's mood, so they key off these.
 */

// ── Requests for a human (requirement 6.1) ────────────────────────────────────

const HUMAN_REQUEST: readonly RegExp[] = [
  // English
  /\b(human|real person|actual person|live agent|customer care executive)\b/i,
  /\b(transfer|call transfer|transfer call|transfer me|handover|hand over)\b/i,
  /\b(speak|talk|connect|transfer|put me through)\b[^.?!]{0,30}\b(agent|representative|rep|manager|supervisor|someone|somebody|person)\b/i,
  /\b(agent|representative|manager|supervisor)\b[^.?!]{0,20}\b(please|now|right now)\b/i,
  /\b(escalate|escalation)\b/i,
  // Romanised Hindi
  /\b(insaan|insan|aadmi|admi|bande|banda|manushya)\b/i,
  /\b(kisi\s*se|kisi\s*insaan\s*se|manager\s*se|senior\s*se)\b[^.?!]{0,20}\b(baat|bat)\b/i,
  /\b(baat\s*kara?o|baat\s*karwao|connect\s*kar[oa]|transfer\s*kar[oa])\b/i,
  // Devanagari
  /(इंसान|आदमी|प्रतिनिधि|मैनेजर|सुपरवाइज़र|सुपरवाइजर)/,
  /(किसी\s*से\s*बात|बात\s*कराओ|बात\s*करवाओ|सीनियर\s*से|ट्रांसफर)/,
];

/** Phrases that mean "I do not want your help", not merely "I want a human". */
const REFUSES_AI_HELP: readonly RegExp[] = [
  /\b(don'?t|do not|dont)\b[^.?!]{0,20}\b(want|need)\b[^.?!]{0,20}\b(bot|robot|machine|ai|automated)\b/i,
  /\b(stop|quit)\b[^.?!]{0,20}\b(wasting|waste)\b[^.?!]{0,15}\b(my )?time\b/i,
  /\b(useless|pointless|no use|not helping|can'?t help me)\b/i,
  /\b(nahi\s*chahiye|nahi\s*sun\s*rah[ae]|time\s*waste|bekar|bakwas|faayda\s*nahi)\b/i,
  /(समय\s*बर्बाद|बेकार|काम\s*नहीं|मदद\s*नहीं|नहीं\s*चाहिए)/,
];

export interface HumanRequestSignal {
  requested: boolean;
  /** True when the caller rejected AI help outright, not just asked for a human. */
  refusesAiHelp: boolean;
}

export function detectHumanRequest(utterance: string): HumanRequestSignal {
  const requested = HUMAN_REQUEST.some((p) => p.test(utterance));
  const refusesAiHelp = REFUSES_AI_HELP.some((p) => p.test(utterance));
  return { requested: requested || refusesAiHelp, refusesAiHelp };
}

// ── Agreement / disagreement ──────────────────────────────────────────────────

const AFFIRMATIVE: readonly RegExp[] = [
  /^\s*(yes|yeah|yep|yup|correct|right|exactly|that'?s right|absolutely|sure|ok|okay|confirm(ed)?)\b/i,
  /\b(that'?s (the one|it|right|correct))\b/i,
  /^\s*(haan|han|haa|ha|ji|ji haan|bilkul|sahi|thik|theek|theek hai|sahi hai|correct hai)\b/i,
  /^\s*(हाँ|हां|जी|जी हाँ|बिल्कुल|सही|ठीक|ठीक है|सही है)/,
];

const NEGATIVE: readonly RegExp[] = [
  /^\s*(no|nope|nah|wrong|incorrect|not (that|it|right|correct)|negative)\b/i,
  /\b(that'?s (not right|not correct|wrong)|isn'?t right)\b/i,
  /^\s*(nahi|nahin|na|galat|gadbad)\b/i,
  /^\s*(नहीं|ना|गलत|गड़बड़)/,
];

export type Agreement = "yes" | "no" | "unclear";

/**
 * Read a yes/no answer to a read-back.
 *
 * Returns `unclear` rather than guessing when both or neither fire — a
 * misread "no" on an order-ID confirmation would let the AI proceed against a
 * stranger's order, so ambiguity must re-ask rather than assume.
 */
export function detectAgreement(utterance: string): Agreement {
  const yes = AFFIRMATIVE.some((p) => p.test(utterance));
  const no = NEGATIVE.some((p) => p.test(utterance));
  if (yes && !no) return "yes";
  if (no && !yes) return "no";
  return "unclear";
}

// ── Intent hints ──────────────────────────────────────────────────────────────

const CANCEL_HINT: readonly RegExp[] = [
  /\b(cancel|cancellation|call it off)\b/i,
  /\b(cancel\s*kar|radd|band\s*kar)\b/i,
  /(रद्द|कैंसल|बंद\s*कर)/,
];

const RETURN_HINT: readonly RegExp[] = [
  /\b(return|send it back|take it back|exchange|replace(ment)?)\b/i,
  /\b(wapas|wapis|lauta|badal)\b/i,
  /(वापस|लौटा|बदल|रिटर्न)/,
];

const REFUND_HINT: readonly RegExp[] = [
  /\b(refund|money back|reimburse|paisa\s*wapas)\b/i,
  /\b(paise\s*wapas|paisa\s*wapis|refund\s*kar)\b/i,
  /(रिफंड|पैसे\s*वापस|पैसा\s*वापस)/,
];

export interface IntentHints {
  cancel: boolean;
  return_: boolean;
  refund: boolean;
}

/**
 * Cheap lexical hints about what the caller wants.
 *
 * Used to cross-check the model's intent classification. Requirements 6.2 and
 * 6.3 hinge on correctly spotting cancel / return / refund, and a model that
 * mislabels "I want my money back" as `order_status` would silently bypass the
 * handover rule — so policy consults both.
 */
export function detectIntentHints(utterance: string): IntentHints {
  return {
    cancel: CANCEL_HINT.some((p) => p.test(utterance)),
    return_: RETURN_HINT.some((p) => p.test(utterance)),
    refund: REFUND_HINT.some((p) => p.test(utterance)),
  };
}

// ── Language ──────────────────────────────────────────────────────────────────

const DEVANAGARI = /[ऀ-ॿ]/;

/** Common romanised-Hindi function words, which Latin script alone can't reveal. */
const ROMAN_HINDI =
  /\b(mera|meri|mujhe|aap|aapka|kya|kyu|kyun|nahi|hai|hain|karo|kar|kab|kahan|kaise|bhai|order\s*kahan|abhi|thoda|bata|batao|chahiye|hua|liya|diya)\b/i;

/**
 * Best-effort language of an utterance.
 *
 * Devanagari is decisive. Otherwise romanised-Hindi markers decide, because a
 * caller typing "mera order kahan hai" is speaking Hindi even though every
 * character is Latin — and picking an English voice for that reply is exactly
 * what makes the current agent sound wrong.
 */
export function detectLanguage(
  utterance: string,
  fallback: LanguageCode = "en",
): LanguageCode {
  if (DEVANAGARI.test(utterance)) return "hi";
  if (ROMAN_HINDI.test(utterance)) return "hi";
  return fallback;
}

/** Extract plausible order-id candidates from an utterance. */
export function extractOrderIdCandidates(utterance: string): string[] {
  const found = new Set<string>();

  // Full formatted ids: ORD-773-9921, ECH-2026-00042.
  for (const m of utterance.matchAll(
    /\b([A-Z]{3}-[\dA-Z]{3,4}-[\dA-Z]{4,5})\b/gi,
  )) {
    if (m[1]) found.add(m[1].toUpperCase());
  }

  // Bare digit runs of 4+, as spoken ("it's 4852"). Strip separators callers
  // insert when reading digits aloud: "4 8 5 2", "4-8-5-2".
  const collapsed = utterance.replace(/(?<=\d)[\s-](?=\d)/g, "");
  for (const m of collapsed.matchAll(/\b(\d{4,12})\b/g)) {
    if (m[1]) found.add(m[1]);
  }

  return [...found];
}

// ── Names ─────────────────────────────────────────────────────────────────────

/**
 * Explicit self-identification, in all three scripts.
 *
 * Capturing group 1 is the name. Ordered longest-pattern-first so "my name is"
 * wins over a bare "is".
 */
const NAME_PATTERNS: readonly RegExp[] = [
  /\bmy\s+name\s+(?:is|was)\s+([\p{L}][\p{L}\s.'-]{1,48})/iu,
  /\b(?:this|it)\s*(?:'s|\s+is)\s+([\p{L}][\p{L}\s.'-]{1,48})\s*(?:here|speaking)?$/iu,
  /\bi\s*(?:'m|\s+am)\s+([\p{L}][\p{L}\s.'-]{1,48})/iu,
  /\bname\s*[:\-]\s*([\p{L}][\p{L}\s.'-]{1,48})/iu,
  /^([\p{L}][\p{L}\s.'-]{1,48})\s+(?:here|speaking)\b/iu,
  // Romanised Hindi: "mera naam Rahul hai", "main Rahul bol raha hoon"
  /\bmera\s+naam\s+([\p{L}][\p{L}\s.'-]{1,48}?)\s*(?:hai|hu|hun|hoon)?\b/iu,
  /\bmain\s+([\p{L}][\p{L}\s.'-]{1,48}?)\s+bol\s*(?:raha|rahi)\b/iu,
  // Devanagari: "मेरा नाम राहुल शर्मा है", "मैं राहुल बोल रहा हूँ"
  /मेरा\s+नाम\s+([\p{L}][\p{L}\s.'-]{1,48}?)\s*(?:है|हूँ|हूं)?/u,
  /मैं\s+([\p{L}][\p{L}\s.'-]{1,48}?)\s+बोल\s*(?:रहा|रही)/u,
];

/** Words that are never a name, so a bare-name guess cannot swallow them. */
const NOT_A_NAME =
  /^(yes|yeah|yep|no|nope|ok|okay|sure|thanks|thank you|hello|hi|hey|please|correct|right|wrong|human|agent|order|refund|return|cancel|delivery|haan|nahi|ji|theek|accha|namaste|shukriya)$/i;

/**
 * Read a person's name from an utterance.
 *
 * `expectingName` matters: when the AI has just asked whose name the order is
 * under, a bare "Rahul Sharma" is the answer — but the same two words mid-call
 * are far more likely to be something else, so the bare-name fallback only
 * applies when a name was actually requested. Without this the engine could not
 * verify identity at all unless the language model happened to extract it, which
 * left the whole requirement-7 gate dependent on the model being available.
 */
export function extractPersonName(
  utterance: string,
  expectingName: boolean,
): string | null {
  const text = utterance.trim();
  if (text.length === 0) return null;

  for (const pattern of NAME_PATTERNS) {
    const match = pattern.exec(text);
    const captured = match?.[1]?.trim();
    if (captured && isPlausibleName(captured)) return tidyName(captured);
  }

  if (!expectingName) return null;

  // Bare answer to "whose name is the order under?" — strip a leading filler
  // ("it's", "yeh", "ji") and take what remains if it looks like a name.
  const bare = text
    .replace(/^(?:it'?s|its|yeh|ye|ji|haan|yes|umm+|uh+)\s+/i, "")
    .replace(/[.!?,]+$/, "")
    .trim();

  return isPlausibleName(bare) ? tidyName(bare) : null;
}

function isPlausibleName(candidate: string): boolean {
  if (/\d/.test(candidate)) return false;
  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  if (words.some((w) => NOT_A_NAME.test(w))) return false;
  if (NOT_A_NAME.test(candidate)) return false;
  // At least one word of real length, to reject "a b".
  return words.some((w) => w.length >= 2) && candidate.length >= 2;
}

function tidyName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      // Leave Devanagari alone; it has no case.
      /[ऀ-ॿ]/.test(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(" ");
}

/** Free-text reason for a cancellation / return / refund. */
export function extractReason(utterance: string): string | null {
  const text = utterance.trim();
  if (text.length < 8) return null;

  // "because ...", "since ...", "kyunki ...", "क्योंकि ..."
  const causal = /\b(?:because|since|as|kyunki|kyonki)\b\s+(.{6,160})/i.exec(
    text,
  );
  if (causal?.[1]) return causal[1].trim().replace(/[.!?]+$/, "");

  const devanagariCausal = /क्योंकि\s+(.{6,160})/u.exec(text);
  if (devanagariCausal?.[1]) return devanagariCausal[1].trim();

  // Common bare statements of reason.
  if (
    /\b(mistake|by accident|don'?t need|no longer need|too late|wrong (item|size|colour|color|product)|damaged|defective|not working|broken|found (it )?cheaper|changed my mind|duplicate|late|delayed)\b/i.test(
      text,
    ) ||
    /(galat|kharab|toot|zarurat nahi|der ho gay|nahi chahiye)/i.test(text) ||
    /(गलत|खराब|टूट|ज़रूरत नहीं|देर हो गय|नहीं चाहिए)/u.test(text)
  ) {
    return text.replace(/[.!?]+$/, "").slice(0, 200);
  }

  return null;
}
