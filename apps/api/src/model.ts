import { GoogleGenAI } from "@google/genai";
import type { ModelTurnOutput } from "@echosphere/core";
import { TURN_RESPONSE_SCHEMA } from "@echosphere/core";
import { config } from "./config.js";

/**
 * Gemini client using official `@google/genai` SDK.
 *
 * Gemini is the AI reasoning/LLM decisive brain. It honours `GEMINI_MODEL`
 * (defaulting to `gemini-3.7-flash`), never exposes the API key to the browser,
 * and seamlessly fails over to fallback flash candidates if 503 load spikes occur.
 */

export interface ModelClient {
  readonly available: boolean;
  generate(input: { system: string; prompt: string }): Promise<ModelTurnOutput>;
  summarise(transcript: string): Promise<string>;
}

function extractJson(raw: string): any {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw new Error(`Invalid JSON: ${trimmed.slice(0, 100)}`);
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errMsg: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errMsg)), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

class GeminiClient implements ModelClient {
  private ai: GoogleGenAI;
  private readonly modelsToTry: string[];

  constructor(
    apiKey: string,
    private readonly modelId: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
    const fallbacks = [
      "gemini-3.6-flash",
      "gemini-3.8-flash",
      "gemini-flash-latest",
    ];
    this.modelsToTry = Array.from(new Set([modelId, ...fallbacks]));
  }

  readonly available = true;

  async generate(input: {
    system: string;
    prompt: string;
  }): Promise<ModelTurnOutput> {
    let lastError: unknown = null;

    for (const m of this.modelsToTry) {
      try {
        const response = await withTimeout(
          this.ai.models.generateContent({
            model: m,
            contents: input.prompt,
            config: {
              systemInstruction: input.system,
              responseMimeType: "application/json",
              temperature: 0.3,
              maxOutputTokens: 256,
            },
          }),
          7000,
          `Model ${m} timed out after 7000ms`,
        );

        const rawText =
          response.text ??
          (response as any).candidates?.[0]?.content?.parts
            ?.map((p: any) => p.text)
            .join("") ??
          "";
        const parsed = extractJson(rawText) as ModelTurnOutput;
        const reply =
          parsed.reply ||
          (parsed as any).response ||
          (parsed as any).text ||
          (parsed as any).message ||
          (parsed as any).content ||
          "";

        if (typeof reply !== "string" || reply.trim().length === 0) {
          throw new Error(`Empty reply in JSON: ${rawText.slice(0, 100)}`);
        }
        return { ...parsed, reply: reply.trim() };
      } catch (err: any) {
        lastError = err;
        console.warn(
          `[gemini/@google/genai] Model ${m} failed (${err?.message?.slice(0, 100)}), trying fallback...`,
        );
      }
    }

    console.warn(
      "[gemini/@google/genai] All candidates failed, providing graceful fallback reply",
    );
    return {
      reply:
        "I understand you need assistance. Could you please provide your order number or let me know what you would like help with?",
    };
  }

  async summarise(transcript: string): Promise<string> {
    for (const m of this.modelsToTry) {
      try {
        const response = await this.ai.models.generateContent({
          model: m,
          contents:
            "Summarise this customer support call for the human agent taking it over. " +
            "Three sentences maximum, plain prose, no bullet points. State what the caller wants, " +
            `what has been verified, and what is unresolved.\n\n${transcript}`,
        });
        return response.text?.trim() ?? "Summary unavailable.";
      } catch {
        continue;
      }
    }
    return "Summary unavailable — language model could not summarise.";
  }
}

/**
 * Stand-in used when no API key is configured.
 *
 * Deliberately throws on `generate` rather than returning canned text: the turn
 * pipeline already has template fallbacks chosen by the policy engine, and those
 * are better than anything a stub could invent — they at least say the right
 * *kind* of thing for the current step.
 */
class UnavailableModel implements ModelClient {
  readonly available = false;

  async generate(): Promise<ModelTurnOutput> {
    throw new Error("No language model configured");
  }

  async summarise(): Promise<string> {
    return "Summary unavailable — no language model configured.";
  }
}

let cached: ModelClient | null = null;

export function getModel(): ModelClient {
  if (cached) return cached;
  cached = config.gemini.enabled
    ? new GeminiClient(config.gemini.apiKey, config.gemini.model)
    : new UnavailableModel();
  return cached;
}
