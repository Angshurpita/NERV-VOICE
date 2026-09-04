import type { LanguageCode } from "./types.js";

/**
 * Speech text preparation — requirement 4.
 *
 * The browser's `hi-IN` voice is not going to become a neural voice, but a large
 * part of why the current agent sounds robotic is not the voice at all: it is
 * being handed raw text. `ORD-773-9921` gets read as a mangled word, `₹29,990`
 * as "rupee two nine comma nine nine zero", `2026-08-21` as a subtraction, and
 * markdown asterisks as audible clicks.
 *
 * Everything here is pure and unit-tested, so the awkward bits (Hindi cardinal
 * numbers are deeply irregular) stay verifiable.
 */

// ── Hindi cardinals ───────────────────────────────────────────────────────────

const HI_DIGITS = [
  "शून्य",
  "एक",
  "दो",
  "तीन",
  "चार",
  "पाँच",
  "छह",
  "सात",
  "आठ",
  "नौ",
] as const;

/**
 * 0–99 spelled out. Hindi has a distinct word for nearly every one of these —
 * there is no regular "twenty + one" rule to lean on — so the table is explicit.
 */
const HI_TENS: readonly string[] = [
  "शून्य",
  "एक",
  "दो",
  "तीन",
  "चार",
  "पाँच",
  "छह",
  "सात",
  "आठ",
  "नौ",
  "दस",
  "ग्यारह",
  "बारह",
  "तेरह",
  "चौदह",
  "पंद्रह",
  "सोलह",
  "सत्रह",
  "अठारह",
  "उन्नीस",
  "बीस",
  "इक्कीस",
  "बाईस",
  "तेईस",
  "चौबीस",
  "पच्चीस",
  "छब्बीस",
  "सत्ताईस",
  "अट्ठाईस",
  "उनतीस",
  "तीस",
  "इकतीस",
  "बत्तीस",
  "तैंतीस",
  "चौंतीस",
  "पैंतीस",
  "छत्तीस",
  "सैंतीस",
  "अड़तीस",
  "उनतालीस",
  "चालीस",
  "इकतालीस",
  "बयालीस",
  "तैंतालीस",
  "चौवालीस",
  "पैंतालीस",
  "छियालीस",
  "सैंतालीस",
  "अड़तालीस",
  "उनचास",
  "पचास",
  "इक्यावन",
  "बावन",
  "तिरेपन",
  "चौवन",
  "पचपन",
  "छप्पन",
  "सत्तावन",
  "अट्ठावन",
  "उनसठ",
  "साठ",
  "इकसठ",
  "बासठ",
  "तिरेसठ",
  "चौंसठ",
  "पैंसठ",
  "छियासठ",
  "सड़सठ",
  "अड़सठ",
  "उनहत्तर",
  "सत्तर",
  "इकहत्तर",
  "बहत्तर",
  "तिहत्तर",
  "चौहत्तर",
  "पचहत्तर",
  "छिहत्तर",
  "सतहत्तर",
  "अठहत्तर",
  "उन्यासी",
  "अस्सी",
  "इक्यासी",
  "बयासी",
  "तिरासी",
  "चौरासी",
  "पचासी",
  "छियासी",
  "सत्तासी",
  "अट्ठासी",
  "नवासी",
  "नब्बे",
  "इक्यानवे",
  "बानवे",
  "तिरानवे",
  "चौरानवे",
  "पंचानवे",
  "छियानवे",
  "सत्तानवे",
  "अट्ठानवे",
  "निन्यानवे",
];

/**
 * A number in Hindi words, using the Indian system (thousand → lakh → crore,
 * not thousand → million). ₹1,34,900 is "एक लाख चौंतीस हज़ार नौ सौ", which is
 * what an Indian listener expects; "one hundred thirty-four thousand" is not.
 */
export function hindiNumberWords(value: number): string {
  if (!Number.isFinite(value)) return "";
  const n = Math.floor(Math.abs(value));
  if (n === 0) return HI_TENS[0]!;

  const parts: string[] = [];

  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const hundred = Math.floor((n % 1000) / 100);
  const rest = n % 100;

  if (crore > 0) parts.push(`${hindiNumberWords(crore)} करोड़`);
  if (lakh > 0) parts.push(`${below100(lakh)} लाख`);
  if (thousand > 0) parts.push(`${below100(thousand)} हज़ार`);
  if (hundred > 0) parts.push(`${HI_TENS[hundred]!} सौ`);
  if (rest > 0) parts.push(below100(rest));

  return parts.join(" ");
}

function below100(n: number): string {
  return HI_TENS[n] ?? String(n);
}

const EN_ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
] as const;

/**
 * Read a digit string one digit at a time.
 *
 * This is how Indian support agents actually read order numbers back, and it is
 * the single biggest intelligibility win over a noisy line: "four eight five
 * two" survives compression that "four thousand eight hundred fifty-two" does
 * not. The separator is a comma so the synthesiser inserts a real pause between
 * digits instead of running them together.
 */
export function speakDigits(digits: string, lang: LanguageCode): string {
  const table = lang === "hi" ? HI_DIGITS : EN_ONES;
  return digits
    .split("")
    .filter((c) => /\d/.test(c))
    .map((c) => table[Number(c)]!)
    .join(", ");
}

// ── Dates ─────────────────────────────────────────────────────────────────────

const HI_MONTHS = [
  "जनवरी",
  "फ़रवरी",
  "मार्च",
  "अप्रैल",
  "मई",
  "जून",
  "जुलाई",
  "अगस्त",
  "सितंबर",
  "अक्टूबर",
  "नवंबर",
  "दिसंबर",
] as const;

const EN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** `2026-08-21` → `21 अगस्त` / `21 August`. Year is dropped as noise on a call. */
export function speakDate(iso: string, lang: LanguageCode): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (month < 0 || month > 11) return iso;
  return lang === "hi"
    ? `${below100(day)} ${HI_MONTHS[month]!}`
    : `${day} ${EN_MONTHS[month]!}`;
}

// ── Abbreviations ─────────────────────────────────────────────────────────────

const ABBREVIATIONS: ReadonlyArray<[RegExp, { hi: string; en: string }]> = [
  [/\bCOD\b/g, { hi: "कैश ऑन डिलीवरी", en: "cash on delivery" }],
  [/\bUPI\b/g, { hi: "यू पी आई", en: "U P I" }],
  [/\bEMI\b/g, { hi: "ई एम आई", en: "E M I" }],
  [/\bETA\b/g, { hi: "अनुमानित समय", en: "estimated time" }],
  [/\bOTP\b/g, { hi: "ओ टी पी", en: "O T P" }],
  [/\bRTO\b/g, { hi: "वापस भेजा गया", en: "returned to origin" }],
  [/\bSKU\b/g, { hi: "एस के यू", en: "S K U" }],
  [/\bAWB\b/g, { hi: "ए डब्ल्यू बी", en: "A W B" }],
];

// ── Main pipeline ─────────────────────────────────────────────────────────────

/**
 * Prepare a reply for the speech synthesiser.
 *
 * Order matters throughout. Currency and dates consume their digits *before* the
 * generic identifier rule runs, otherwise `₹29,990` would be read out digit by
 * digit as though it were an order number.
 */
export function normaliseForSpeech(text: string, lang: LanguageCode): string {
  let out = text;

  // 1 — strip anything that is punctuation for the eye, not the ear.
  out = out.replace(/```[\s\S]*?```/g, " ");
  out = out.replace(/[*_`#>|]/g, "");
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  out = out.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "");
  out = out.replace(/^\s*[-•–]\s+/gm, "");

  // 2 — models sometimes spell punctuation out loud; drop those words.
  out = out.replace(
    /\b(comma|full stop|period|exclamation mark|question mark|colon|semicolon)\b/gi,
    "",
  );

  // 3 — currency, in every form the model tends to emit.
  out = out.replace(
    /(?:₹|Rs\.?|INR)\s?([\d,]+(?:\.\d{1,2})?)/gi,
    (_m, raw: string) => amountToWords(raw, lang),
  );

  // 4 — ISO dates.
  out = out.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (m) => speakDate(m, lang));

  // 5 — identifiers. Formatted ids first, then any remaining long digit run
  //     (order numbers, tracking references, phone numbers).
  out = out.replace(
    /\b([A-Z]{2,4})-([\dA-Z]{2,5})-([\dA-Z]{3,6})\b/gi,
    (_m, a: string, b: string, c: string) =>
      `${spellLetters(a, lang)} ${speakDigits(b, lang)} ${speakDigits(c, lang)}`,
  );
  out = out.replace(/\b\d{4,14}\b/g, (m) => speakDigits(m, lang));

  // 6 — abbreviations.
  for (const [pattern, replacement] of ABBREVIATIONS) {
    out = out.replace(pattern, lang === "hi" ? replacement.hi : replacement.en);
  }

  // 7 — percentages and ordinals read badly in Hindi as symbols.
  out = out.replace(/(\d+)\s?%/g, (_m, n: string) =>
    lang === "hi" ? `${hindiNumberWords(Number(n))} प्रतिशत` : `${n} percent`,
  );

  // 8 — tidy.
  out = out.replace(/\s{2,}/g, " ");
  out = out.replace(/\s+([,.!?])/g, "$1");
  out = out.replace(/,\s*,/g, ",");
  return out.trim();
}

function amountToWords(raw: string, lang: LanguageCode): string {
  const numeric = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return raw;
  const rupees = Math.floor(numeric);
  const paise = Math.round((numeric - rupees) * 100);

  if (lang === "hi") {
    const main = `${hindiNumberWords(rupees)} रुपये`;
    return paise > 0 ? `${main} ${hindiNumberWords(paise)} पैसे` : main;
  }
  const main = `${rupees.toLocaleString("en-IN")} rupees`;
  return paise > 0 ? `${main} ${paise} paise` : main;
}

/** Read a short letter group as letters ("ORD" → "ओ आर डी"). */
function spellLetters(letters: string, lang: LanguageCode): string {
  const HI_LETTERS: Record<string, string> = {
    A: "ए",
    B: "बी",
    C: "सी",
    D: "डी",
    E: "ई",
    F: "एफ",
    G: "जी",
    H: "एच",
    I: "आई",
    J: "जे",
    K: "के",
    L: "एल",
    M: "एम",
    N: "एन",
    O: "ओ",
    P: "पी",
    Q: "क्यू",
    R: "आर",
    S: "एस",
    T: "टी",
    U: "यू",
    V: "वी",
    W: "डब्ल्यू",
    X: "एक्स",
    Y: "वाई",
    Z: "ज़ेड",
  };
  return letters
    .toUpperCase()
    .split("")
    .map((c) => (lang === "hi" ? (HI_LETTERS[c] ?? c) : c))
    .join(" ");
}

// ── Chunking ──────────────────────────────────────────────────────────────────

/**
 * Split text into utterance-sized chunks.
 *
 * Two reasons. Chrome silently truncates long `SpeechSynthesisUtterance` text,
 * so a long reply can simply stop mid-sentence; and prosody flattens badly over
 * a long string, which is much of the "robotic" impression. Speaking clause by
 * clause keeps intonation alive and makes barge-in responsive, because cancelling
 * only drops the current chunk.
 */
export function chunkForSpeech(text: string, maxChars = 180): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  // Devanagari uses "।" as a full stop; treat it as a boundary too.
  const sentences = trimmed.split(/(?<=[.!?।])\s+/);
  const chunks: string[] = [];
  let current = "";

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      push();
      // Still too long — break on commas and conjunctions rather than mid-word.
      let rest = sentence;
      while (rest.length > maxChars) {
        const slice = rest.slice(0, maxChars);
        const cut = Math.max(
          slice.lastIndexOf(", "),
          slice.lastIndexOf(" और "),
          slice.lastIndexOf(" "),
        );
        const at = cut > maxChars * 0.5 ? cut : maxChars;
        chunks.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      if (rest) current = rest;
      continue;
    }

    if ((current + " " + sentence).trim().length > maxChars) push();
    current = current ? `${current} ${sentence}` : sentence;
  }
  push();

  return chunks.filter((c) => c.length > 0);
}
