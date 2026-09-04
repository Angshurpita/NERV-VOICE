import { Router } from "express";
import agoraToken from "agora-token";
import { catalogueStats, getDatabase, SCENARIOS } from "@echosphere/db";
import {
  assessReturn,
  evaluateCancellation,
  humanStatus,
} from "@echosphere/core";
import { attachUser, requireRole } from "../auth.js";
import { config, policy } from "../config.js";
import { agoraService } from "../agora.js";
import { handleTurn } from "../conversation.js";
import { logVoiceDiagnostic } from "../diagnostics.js";

/**
 * `agora-token` is CommonJS, so it exposes no named ESM bindings — importing
 * `{ RtcRole }` directly resolves under tsc but throws at runtime. Destructuring
 * the default export is the interop that actually works.
 */
const { RtcRole, RtcTokenBuilder } = agoraToken;

/**
 * Analytics, catalogue and Agora routes.
 */

// ── Analytics ─────────────────────────────────────────────────────────────────

export const analyticsRouter = Router();
analyticsRouter.use(attachUser, requireRole("agent"));

analyticsRouter.get("/overview", async (_req, res) => {
  const db = await getDatabase(config.DATABASE_URL);
  res.json(await db.analytics.overview());
});

analyticsRouter.get("/trends", async (req, res) => {
  const db = await getDatabase(config.DATABASE_URL);
  const days = Math.min(Math.max(Number(req.query.days ?? 14) || 14, 7), 90);
  res.json({ trends: await db.analytics.trends(days) });
});

/**
 * One request for every breakdown the analytics page draws.
 *
 * Batched deliberately: five separate endpoints meant five round trips and five
 * loading states for a page that always shows all five charts together.
 */
analyticsRouter.get("/breakdowns", async (_req, res) => {
  const db = await getDatabase(config.DATABASE_URL);
  const [intents, reasons, languages] = await Promise.all([
    db.analytics.topIntents(),
    db.analytics.escalationReasons(),
    db.analytics.languageMix(),
  ]);
  res.json({ intents, escalationReasons: reasons, languages });
});

// ── Catalogue ─────────────────────────────────────────────────────────────────

export const catalogueRouter = Router();

/**
 * Test scenarios, for the caller simulator's reference panel.
 *
 * Public, and served from the same table the tests read, so the panel can never
 * describe an order that does not exist — which is exactly what the old
 * hardcoded cards did.
 */
catalogueRouter.get("/scenarios", (_req, res) => {
  res.json({ scenarios: SCENARIOS, stats: catalogueStats() });
});

catalogueRouter.get(
  "/orders",
  attachUser,
  requireRole("agent"),
  async (_req, res) => {
    const db = await getDatabase(config.DATABASE_URL);
    const orders = db.orders.list();
    const customers = new Map(db.orders.customers().map((c) => [c.id, c]));

    res.json({
      orders: orders.map((o) => ({
        id: o.id,
        status: o.status,
        statusLabel: humanStatus(o.status),
        customerName: customers.get(o.customerId)?.name ?? "Unknown",
        items: o.items.map((i) => i.name),
        totalInr: o.totalInr,
        paymentMethod: o.paymentMethod,
        placedAt: o.placedAt,
        expectedDeliveryAt: o.expectedDeliveryAt,
        deliveredAt: o.deliveredAt,
        city: o.city,
        courier: o.courier,
        trackingId: o.trackingId,
        returnWindowDays: o.returnWindowDays,
        failedDeliveryAttempts: o.failedDeliveryAttempts,
      })),
      total: orders.length,
    });
  },
);

/** Policy explainer for one order — powers the "why" panel on a case. */
catalogueRouter.get(
  "/orders/:id/policy",
  attachUser,
  requireRole("agent"),
  async (req, res) => {
    const db = await getDatabase(config.DATABASE_URL);
    const result = await db.orders.lookup(req.params.id!);
    if (result.outcome !== "found") {
      res.status(404).json({ error: `No order matches ${req.params.id}` });
      return;
    }

    res.json({
      order: result.order,
      customer: { name: result.customer.name, city: result.customer.city },
      cancellation: evaluateCancellation(result.order, policy),
      return: assessReturn(result.order),
    });
  },
);

// ── Agora ─────────────────────────────────────────────────────────────────────

export const agoraRouter = Router();

agoraRouter.get("/status", (_req, res) => {
  res.json(agoraService.getStatus());
});

/**
 * Agora CustomLLM Health Check endpoint.
 * Usable through public URL to verify that Agora can reach the backend.
 * Never exposes secrets or credentials.
 */
const customLlmHealthHandler = (_req: any, res: any) => {
  res.json({
    ok: true,
    service: "agora-custom-llm",
    endpoint: "/api/agora/openai/v1/chat/completions",
    sttProvider: "deepgram",
    ttsProvider: "deepgram_aura",
    ttsModel: config.deepgram.ttsModel,
    llmConfigured: Boolean(config.agora.llmUrl),
  });
};

agoraRouter.get("/openai/health", customLlmHealthHandler);
agoraRouter.get("/openai/v1/health", customLlmHealthHandler);

/**
 * Authoritative Custom LLM endpoint for the real Agora Conversational AI Agent.
 *
 * Pipeline:
 * Caller Microphone -> Agora RTC -> Deepgram STT -> POST /chat/completions -> EchoSphere runTurn() -> Deepgram Aura TTS -> Agora RTC
 */
const chatCompletionHandler = async (req: any, res: any) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const userMsg = [...messages].reverse().find((m: any) => m.role === "user");
    let userUtterance = "";
    if (typeof userMsg?.content === "string") {
      userUtterance = userMsg.content.trim();
    } else if (Array.isArray(userMsg?.content)) {
      userUtterance = userMsg.content
        .filter(
          (p: any) => p?.type === "text" || typeof p?.text === "string",
        )
        .map((p: any) => p.text || p.content || "")
        .join(" ")
        .trim();
    }

    let callId =
      (typeof req.query?.callId === "string" && req.query.callId) ||
      (typeof req.body?.callId === "string" && req.body.callId) ||
      (typeof req.headers?.["x-call-id"] === "string" &&
        req.headers["x-call-id"]) ||
      undefined;
    const channelName =
      (typeof req.query?.channel === "string" && req.query.channel) ||
      (typeof req.body?.channel === "string" && req.body.channel) ||
      (typeof req.headers?.["x-channel-name"] === "string" &&
        req.headers["x-channel-name"]) ||
      undefined;

    if (!callId && channelName) {
      const db = await getDatabase(config.DATABASE_URL);
      const call = await db.calls.findByChannel(channelName);
      if (call) callId = call.id;
    }

    if (!callId) {
      logVoiceDiagnostic("PIPELINE_ERROR", {
        error: "CustomLLM turn rejected: missing deterministic callId/channel",
        channelName,
      });
      res.status(400).json({
        error: {
          message:
            "A deterministic callId or channel is required for EchoSphere turn processing",
          type: "invalid_request_error",
        },
      });
      return;
    }

    logVoiceDiagnostic("CUSTOM_LLM_REQUEST_RECEIVED", {
      callId,
      channelName,
      stream: Boolean(req.body?.stream),
      utterance: userUtterance,
    });

    if (!userUtterance) {
      const fallbackReply = "Hello, how can I help you today?";
      logVoiceDiagnostic("CUSTOM_LLM_RESPONSE_SENT", {
        callId,
        channelName,
        stream: false,
        replyLength: fallbackReply.length,
      });
      res.json({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: req.body?.model || "echosphere-authoritative-brain",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: fallbackReply,
            },
            finish_reason: "stop",
          },
        ],
      });
      return;
    }

    logVoiceDiagnostic("STT_UTTERANCE_RECEIVED", {
      callId,
      channelName,
      utterance: userUtterance,
    });

    logVoiceDiagnostic("ECHOSPHERE_TURN_STARTED", {
      callId,
      channelName,
      utterance: userUtterance,
    });

    const outcome = await handleTurn({
      callId,
      text: userUtterance,
      asrConfidence: 0.95,
    });

    const reply =
      "reply" in outcome ? outcome.reply : "I am looking into that for you.";
    const escalated = "escalated" in outcome ? outcome.escalated : false;

    logVoiceDiagnostic("ECHOSPHERE_TURN_COMPLETED", {
      callId,
      channelName,
      reply,
      escalated,
    });

    logVoiceDiagnostic("TTS_RESPONSE_STARTED", {
      callId,
      channelName,
      ttsModel: config.deepgram.ttsModel,
      replyLength: reply.length,
    });

    if (req.body?.stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(
        `data: ${JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: req.body?.model || "echosphere-authoritative-brain",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: reply },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: req.body?.model || "echosphere-authoritative-brain",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`,
      );
      res.write("data: [DONE]\n\n");
      res.end();

      logVoiceDiagnostic("CUSTOM_LLM_RESPONSE_SENT", {
        callId,
        channelName,
        stream: true,
        replyLength: reply.length,
      });
      return;
    }

    logVoiceDiagnostic("CUSTOM_LLM_RESPONSE_SENT", {
      callId,
      channelName,
      stream: false,
      replyLength: reply.length,
    });

    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: req.body?.model || "echosphere-authoritative-brain",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: reply },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: userUtterance.length,
        completion_tokens: reply.length,
        total_tokens: userUtterance.length + reply.length,
      },
    });
  } catch (err: any) {
    console.error("[agora/chat/completions] Error handling LLM turn:", err);
    logVoiceDiagnostic("PIPELINE_ERROR", { error: err.message });
    res.status(500).json({
      error: { message: err.message, type: "internal_error" },
    });
  }
};

agoraRouter.post("/openai/v1/chat/completions", chatCompletionHandler);
agoraRouter.post("/chat/completions", chatCompletionHandler);

agoraRouter.post("/channel", (req, res) => {
  if (!agoraService.isConfigured) {
    res.status(503).json({
      error: "Agora is not configured on this deployment.",
      fallback: null,
    });
    return;
  }

  const channelName =
    (typeof req.body?.channelName === "string" &&
      req.body.channelName.trim()) ||
    `nerv_${Date.now()}`;
  const uid = Number(req.body?.uid ?? 0) || 0;

  try {
    const tokens = agoraService.generateTokens(channelName, uid);
    res.json(tokens);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

agoraRouter.post("/agent/start", async (req, res) => {
  const { channelName, language, greeting, callId } = req.body ?? {};
  if (!channelName) {
    res.status(400).json({ error: "Missing channelName" });
    return;
  }
  const result = await agoraService.startConversationalAgent(
    channelName,
    language ?? "en",
    greeting,
    callId,
  );
  if (!result.ok) {
    res.status(503).json(result);
    return;
  }
  res.json(result);
});

agoraRouter.post("/agent/stop", async (req, res) => {
  const { channelName, agentName, callId } = req.body ?? {};
  const target = channelName || callId;
  if (!target) {
    res.status(400).json({ error: "Missing channelName or callId" });
    return;
  }
  const result = await agoraService.stopConversationalAgent(target, agentName);
  res.json(result);
});

agoraRouter.post("/signalling/publish", (req, res) => {
  const { callId, event, payload } = req.body ?? {};
  if (!callId || !event) {
    res.status(400).json({ error: "Missing callId or event" });
    return;
  }

  const published = agoraService.publishSignalling(
    callId,
    event,
    payload ?? {},
  );
  res.json({ ok: true, event: published });
});

agoraRouter.get("/signalling/events", (req, res) => {
  const callId =
    typeof req.query.callId === "string" ? req.query.callId : undefined;
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 100);
  res.json({ events: agoraService.getRecentEvents(callId, limit) });
});

agoraRouter.get("/signalling/stream", (req, res) => {
  const callId =
    typeof req.query.callId === "string" ? req.query.callId : undefined;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  res.write(
    `data: ${JSON.stringify({ event: "connected", timestamp: new Date().toISOString() })}\n\n`,
  );

  const unsubscribe = agoraService.subscribe((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }, callId);

  req.on("close", () => {
    unsubscribe();
  });
});
