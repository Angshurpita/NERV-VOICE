import type { RetentionPlan } from './persuasion.js';
import type { NextQuestion } from './conversation-state.js';
import type { VerificationPlan } from './verification.js';
import { describeOrder, humanStatus } from './verification.js';
import type { ConversationState, LanguageCode, Order } from './types.js';

/**
 * Prompt construction — requirement 8, "the agent must respond humanly".
 *
 * Two things made the old agent sound like a machine, and only one of them was
 * tone. The other was structure: the entire order table was pasted into the
 * system prompt on every turn, so the model was simultaneously a database, a
 * policy engine and a speaker — and it hedged like something doing three jobs
 * badly. Here it does one job. Facts arrive as tool results, policy arrives as a
 * single instruction, and the model's only remaining task is to say the thing a
 * good human agent would say.
 */

export const AGENT_NAME = 'Agora Voice Agent';

export const SYSTEM_PROMPT = `You are ${AGENT_NAME}, a customer support associate at an Indian e-commerce company. You are on a live voice call. Everything you write is spoken aloud, so write the way people talk, not the way documents read.

HOW YOU SOUND
- One or two sentences per turn. Three at the absolute most. This is a phone call, not an email.
- Use contractions. "I'll", "that's", "you've", "मैं देखती हूँ".
- Acknowledge in a few words, then get on with it. Never open with a paragraph of sympathy.
- Ask one question at a time. Never stack two questions in one turn.
- Vary how you start. Do not begin every turn with "I understand" or "मैं समझती हूँ".
- Sound like you are actually looking at a screen: "right, I can see it", "one second", "मिल गया".

NEVER SAY
- "As an AI", "I'm an AI assistant", "I'm just a bot", or anything about your nature unless directly asked.
- "I apologize for the inconvenience caused." Say "sorry about that" or "माफ़ कीजिए" and move on.
- "Kindly", "Please be informed", "As per our records", "Your request has been noted." This is call-centre script language and it is exactly what you must avoid.
- Bullet points, numbered lists, headings, markdown, or emoji. None of it can be spoken.
- The caller's own sentence repeated back to them.
- Any punctuation name out loud.

LANGUAGE
- Mirror the caller. If they speak Hindi, reply in Hindi using Devanagari script only — never romanised Hinglish. If they speak English, reply in English. If they mix, you may mix naturally the way Indians actually do.
- Mirror their register too. Someone formal gets "आप"; someone casual and quick gets a lighter tone.
- Keep brand and product names in their original Latin spelling inside Hindi sentences. "आपका Sony का हेडफ़ोन" is right. Do not transliterate them.
- Read order numbers digit by digit, never as one large number.

TRUTH
- You may only state facts that came back from a tool result in this conversation. If you have not looked an order up, you do not know anything about it — say so.
- Never say you have cancelled, refunded, returned or arranged anything unless a tool result in this turn confirms it happened.
- Never say a colleague has joined the call. You can say you are connecting them.
- If you are unsure, say you are checking. Do not fill the gap with a guess.

You will be given one instruction per turn describing what this turn must accomplish. Follow it exactly. It comes from the system's policy engine, and it overrides your own judgement about what to do next — your judgement is for *how* to say it.`;

// ── Few-shot examples ─────────────────────────────────────────────────────────

/**
 * Contrastive examples.
 *
 * Included because "be concise and natural" is an instruction models nod along
 * with and then ignore. A bad/good pair is far more effective, and the bad
 * examples below are taken from the phrasings the previous prompt produced.
 */
const FEW_SHOTS = `EXAMPLES — study the difference.

Caller: "Hi, where is my order?"
BAD: "I understand your concern regarding your order. I would be happy to assist you with tracking your shipment. In order to proceed, could you kindly provide me with your order number so that I may look into this matter for you?"
GOOD: "Sure — what's the order number?"

Caller: "मेरा ऑर्डर कहाँ है?"
BAD: "मैं आपकी चिंता को समझती हूँ। आपके ऑर्डर की स्थिति जानने के लिए कृपया अपना ऑर्डर नंबर प्रदान करें ताकि मैं इस मामले को देख सकूँ।"
GOOD: "हाँ बताइए, ऑर्डर नंबर क्या है?"

Caller: "It's 4852."
BAD: "Thank you for providing your order number 4852. I have successfully located your order in our system. Please allow me to confirm the details."
GOOD: "Four, eight, five, two — got it. One second."

Caller: "Yes that's mine."
BAD: "Thank you for the confirmation. I can confirm that your order is currently delayed. We apologize for the inconvenience caused."
GOOD: "Thanks. So it's running late — it was due on the twenty-first and it hasn't moved since Mumbai. Want me to log a delay complaint so it gets pushed?"

Caller: "Just give me a human."
BAD: "Certainly, I will transfer you to a human agent right away."
GOOD: "I can do this one myself in about thirty seconds — your order's right here in front of me. Want me to try?"

Caller: "यार मुझे इंसान से बात करनी है।"
BAD: "ज़रूर, मैं आपको मानव एजेंट से जोड़ रही हूँ।"
GOOD: "एक मिनट दीजिए, ऑर्डर मेरे सामने ही खुला है — मैं अभी बता देती हूँ। फिर भी चाहें तो कलीग से जोड़ दूँगी।"

Caller: "I want to cancel it."  (order is out for delivery)
BAD: "I have cancelled your order successfully."
GOOD: "It's already out with the courier for today, so I can't stop it from here — my colleague can. Let me pass you across with everything filled in."`;

// ── Turn prompt ───────────────────────────────────────────────────────────────

export interface TurnPromptInput {
  state: ConversationState;
  /** Recent turns, oldest first. Trimmed by the caller. */
  history: Array<{ speaker: 'caller' | 'agent'; text: string }>;
  utterance: string;
  /** The order in hand, if one has been looked up and confirmed. */
  order: Order | null;
  /** The single thing this turn must accomplish. */
  instruction: string;
  /** Extra constraint from the safety engine, if any. */
  safetyGuidance: string | null;
  language: LanguageCode;
}

/**
 * Compose one turn.
 *
 * Note what is absent: the order catalogue. The model sees only the order the
 * caller has actually verified, so inventing a status for a different order is
 * not something it can do even if it tries.
 */
export function buildTurnPrompt(input: TurnPromptInput): string {
  const { state, history, utterance, order, instruction, safetyGuidance, language } = input;

  const sections: string[] = [FEW_SHOTS];

  sections.push(
    `CALL SO FAR\n${
      history.length === 0
        ? '(this is the first thing the caller has said)'
        : history.map((h) => `${h.speaker === 'caller' ? 'Caller' : AGENT_NAME}: ${h.text}`).join('\n')
    }`,
  );

  sections.push(
    `WHAT YOU KNOW FOR CERTAIN\n${
      order
        ? `Verified ${describeOrder(order, state.verification.ordererName)}.\n` +
          `Courier: ${order.courier ?? 'not assigned yet'}${order.trackingId ? `, tracking ${order.trackingId}` : ''}.\n` +
          `Delivery address on file: ${order.deliveryAddress}.\n` +
          `Status history: ${order.history.map((e) => `${humanStatus(e.status)} on ${e.at.slice(0, 10)}`).join('; ')}.`
        : 'No order has been verified yet, so you know nothing about any order. Do not describe, guess at, or imply any order detail.'
    }`,
  );

  if (state.humanRequestCount > 0) {
    sections.push(
      `The caller has asked for a human ${state.humanRequestCount} time(s) already. Do not pretend they have not.`,
    );
  }

  if (safetyGuidance) {
    sections.push(`SAFETY CONSTRAINT — this overrides everything below.\n${safetyGuidance}`);
  }

  sections.push(`Caller just said: "${utterance}"`);

  sections.push(
    `THIS TURN MUST DO EXACTLY THIS\n${instruction}\n\n` +
      `Reply in ${language === 'hi' ? 'Hindi, Devanagari script' : 'English'}. ` +
      `One or two sentences. Nothing else — no preamble, no sign-off.`,
  );

  return sections.join('\n\n───\n\n');
}

/**
 * Merge the active policy plans into one instruction.
 *
 * Precedence is deliberate and is where requirement 6 meets requirement 7: a
 * retention attempt outranks the next field question (interrogating someone who
 * just asked for a person loses them), but verification outranks retention
 * (offering to "sort out your order" before knowing which order is a promise the
 * system cannot keep).
 */
export function composeInstruction(args: {
  verification: VerificationPlan;
  retention: RetentionPlan | null;
  question: NextQuestion | null;
  escalating: boolean;
  resolution: string | null;
}): string {
  const { verification, retention, question, escalating, resolution } = args;

  if (escalating) {
    return (
      'Hand the call over. Tell the caller in one or two sentences that you are connecting them to a ' +
      'colleague, that everything you have gathered goes across with them so they will not repeat ' +
      'themselves, and ask them to hold. Do not ask any further question. Do not say the colleague ' +
      'has joined.'
    );
  }

  if (!verification.canProceed) {
    // Retention still gets a voice while verifying, because ignoring a request
    // for a human to ask for an order number again is precisely the behaviour
    // that makes callers escalate.
    if (retention && retention.stance !== 'HAND_OVER') {
      return `${retention.guidance}\n\nThen, in the same breath, do this: ${verification.guidance}`;
    }
    return verification.guidance;
  }

  if (retention && retention.stance !== 'HAND_OVER') {
    return retention.guidance;
  }

  if (resolution) return resolution;

  if (question) {
    return question.kind === 'confirm'
      ? `${question.intent} Ask a direct yes/no question. Read any number digit by digit.`
      : question.intent;
  }

  return (
    'Everything you need is confirmed. Answer what the caller actually asked, using only the facts ' +
    'above, then ask if there is anything else.'
  );
}

// ── Output cleanup ────────────────────────────────────────────────────────────

/** Stock phrases that betray a script. Removed rather than trusted to the model. */
const ROBOTIC: ReadonlyArray<[RegExp, string]> = [
  [/\bI apolog(?:ise|ize) for (?:the|any) inconvenience(?: caused)?\.?\s*/gi, 'Sorry about that. '],
  [/\bas an AI(?: language model| assistant)?,?\s*/gi, ''],
  [/\bI'?m (?:just )?an? (?:AI|bot|automated assistant)[^.!?]*[.!?]\s*/gi, ''],
  [/\bkindly\b/gi, 'please'],
  [/\bplease be informed that\s*/gi, ''],
  [/\bas per (?:our|the) records,?\s*/gi, ''],
  [/\byour request has been noted\.?\s*/gi, ''],
  [/\bI hope (?:this|that) helps[.!]?\s*/gi, ''],
  [/\bIs there anything else I can (?:help|assist) you with today\?/gi, 'Anything else?'],
  [/\bकृपया\s+/g, ''],
  [/\bमैं आपकी (?:चिंता|समस्या) (?:को )?समझती हूँ[।,]?\s*/g, ''],
  [/\bअसुविधा के लिए (?:हमें )?खेद है[।,]?\s*/g, 'माफ़ कीजिए। '],
];

/**
 * Post-process a reply before it is spoken.
 *
 * Belt and braces over the prompt: instructions reduce script language but do
 * not eliminate it, and one "I apologize for the inconvenience caused" undoes a
 * whole call's worth of sounding human.
 */
export function humanise(reply: string, language: LanguageCode, maxSentences = 3): string {
  let out = reply.trim();

  // Structure that cannot be spoken.
  out = out.replace(/```[\s\S]*?```/g, ' ');
  out = out.replace(/^\s*(?:[-*•]|\d+\.)\s+/gm, '');
  out = out.replace(/[*_`#>]/g, '');
  out = out.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '');

  for (const [pattern, replacement] of ROBOTIC) {
    out = out.replace(pattern, replacement);
  }

  out = out.replace(/\s{2,}/g, ' ').trim();

  // Hard cap on length. A model that ignores "two sentences" gets truncated at a
  // sentence boundary rather than mid-clause.
  const sentences = out.split(/(?<=[.!?।])\s+/).filter(Boolean);
  if (sentences.length > maxSentences) {
    out = sentences.slice(0, maxSentences).join(' ');
  }

  if (out.length === 0) {
    return language === 'hi' ? 'एक सेकंड दीजिए।' : 'One second.';
  }

  return out;
}

// ── Model I/O contract ────────────────────────────────────────────────────────

/**
 * Structured-output schema for the turn.
 *
 * The model reports what it heard and drafts a reply; it does not decide intent
 * requirements, escalation, or whether verification passed. `confidence` values
 * are treated as noisy inputs to `confidence.ts`, never as verdicts.
 */
export const TURN_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: [
        'order_status',
        'delivery_complaint',
        'cancellation_request',
        'return_request',
        'refund_request',
        'address_change',
        'general_query',
        'unknown',
      ],
    },
    intentConfidence: { type: 'number' },
    language: { type: 'string', enum: ['hi', 'en'] },
    heard: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        orderIdConfidence: { type: 'number' },
        customerName: { type: 'string' },
        customerNameConfidence: { type: 'number' },
        reason: { type: 'string' },
      },
    },
    wantsHuman: { type: 'boolean' },
    answeredYesNo: { type: 'string', enum: ['yes', 'no', 'neither'] },
    reply: { type: 'string' },
  },
  required: ['intent', 'intentConfidence', 'language', 'reply'],
} as const;

export interface ModelTurnOutput {
  intent: string;
  intentConfidence: number;
  language: LanguageCode;
  heard?: {
    orderId?: string;
    orderIdConfidence?: number;
    customerName?: string;
    customerNameConfidence?: number;
    reason?: string;
  };
  wantsHuman?: boolean;
  answeredYesNo?: 'yes' | 'no' | 'neither';
  reply: string;
}
