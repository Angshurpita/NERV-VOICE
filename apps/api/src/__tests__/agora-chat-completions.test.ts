import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";

// Mock getModel so external calls to Gemini are stubbed
vi.mock("../model.js", () => ({
  getModel: () => ({
    available: true,
    generate: vi.fn().mockResolvedValue({
      reply: "Your order 4852 is on its way and scheduled for delivery today.",
      wantsHuman: false,
    }),
    summarise: vi.fn().mockResolvedValue("Summary of call."),
  }),
}));

import { createApp } from "../app.js";
import { startCall } from "../conversation.js";

describe("Agora Custom LLM OpenAI-Compatible Endpoint", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address() as { port: number };
        baseUrl = `http://localhost:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("provides health status at /api/agora/status", async () => {
    const res = await fetch(`${baseUrl}/api/agora/status`);
    const body: any = await res.json();
    expect(body).toHaveProperty("rtcConfigured");
    expect(body).toHaveProperty("cloudAgentConfigured");
    expect(body).toHaveProperty("sttProvider");
    expect(body.sttProvider).toBe("deepgram");
    expect(body).toHaveProperty("ttsProvider");
    expect(body.ttsProvider).toBe("deepgram_aura");
    expect(body).toHaveProperty("ttsModel");
    expect(body).toHaveProperty("system");
  });

  it("rejects chat completion requests when call identity cannot be resolved (no activeCalls fallback)", async () => {
    const res = await fetch(`${baseUrl}/api/agora/openai/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello?" }],
      }),
    });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("generates Agora channel tokens at /api/agora/channel", async () => {
    const res = await fetch(`${baseUrl}/api/agora/channel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelName: "nerv_test_tokens", uid: 12345 }),
    });

    // In environment without AGORA_APP_ID it may return 503, or 200 if configured
    if (res.status === 200) {
      const data: any = await res.json();
      expect(data).toHaveProperty("rtcToken");
      expect(data.channelName).toBe("nerv_test_tokens");
    } else {
      expect(res.status).toBe(503);
    }
  });

  it("processes speech turn through /api/agora/openai/v1/chat/completions with query callId", async () => {
    // 1. Create a call
    const call = await startCall({
      language: "en",
      channelName: `test_agora_${Date.now()}`,
    });

    // 2. Call OpenAI format endpoint as Agora Cloud Agent CustomLLM does
    const res = await fetch(
      `${baseUrl}/api/agora/openai/v1/chat/completions?callId=${encodeURIComponent(call.callId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "echosphere-authoritative-brain",
          messages: [{ role: "user", content: "Where is my order 4852?" }],
        }),
      },
    );

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.object).toBe("chat.completion");
    expect(Array.isArray(data.choices)).toBe(true);
    expect(data.choices.length).toBeGreaterThan(0);
    expect(data.choices[0].message.role).toBe("assistant");
    expect(typeof data.choices[0].message.content).toBe("string");
    expect(data.choices[0].message.content.length).toBeGreaterThan(5);
    expect(data).toHaveProperty("usage");
  });

  it("resolves call by channel name when callId is not provided", async () => {
    const channel = `channel_resolver_${Date.now()}`;
    await startCall({
      language: "en",
      channelName: channel,
    });

    const res = await fetch(
      `${baseUrl}/api/agora/chat/completions?channel=${encodeURIComponent(channel)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Can I cancel order 4852?" }],
        }),
      },
    );

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.object).toBe("chat.completion");
    expect(data.choices[0].message.role).toBe("assistant");
  });

  it("supports Server-Sent Events (SSE) streaming when stream: true is requested", async () => {
    const call = await startCall({
      language: "en",
      channelName: `channel_stream_${Date.now()}`,
    });

    const res = await fetch(
      `${baseUrl}/api/agora/openai/v1/chat/completions?callId=${encodeURIComponent(call.callId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stream: true,
          messages: [{ role: "user", content: "Hello voice agent" }],
        }),
      },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("data: ");
    expect(text).toContain("[DONE]");
  });

  it("provides Agora CustomLLM health check at /api/agora/openai/health", async () => {
    const res = await fetch(`${baseUrl}/api/agora/openai/health`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toEqual({
      ok: true,
      service: "agora-custom-llm",
      endpoint: "/api/agora/openai/v1/chat/completions",
      sttProvider: "deepgram",
      ttsProvider: "deepgram_aura",
      ttsModel: expect.any(String),
      llmConfigured: expect.any(Boolean),
    });
    // Ensure no secrets are leaked
    expect(body).not.toHaveProperty("apiKey");
    expect(body).not.toHaveProperty("appCertificate");
    expect(body).not.toHaveProperty("customerSecret");
  });

  it("handles multi-part array user message content", async () => {
    const call = await startCall({
      language: "en",
      channelName: `channel_multipart_${Date.now()}`,
    });

    const res = await fetch(
      `${baseUrl}/api/agora/openai/v1/chat/completions?callId=${encodeURIComponent(call.callId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "Where is my order 4852?" }],
            },
          ],
        }),
      },
    );

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.object).toBe("chat.completion");
    expect(data.choices[0].message.role).toBe("assistant");
  });
});
