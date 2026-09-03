import { Router } from 'express';
import agoraToken from 'agora-token';
import { catalogueStats, getDatabase, SCENARIOS } from '@echosphere/db';
import { assessReturn, evaluateCancellation, humanStatus } from '@echosphere/core';
import { attachUser, requireRole } from '../auth.js';
import { config, policy } from '../config.js';
import { agoraService } from '../agora.js';

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
analyticsRouter.use(attachUser, requireRole('agent'));

analyticsRouter.get('/overview', async (_req, res) => {
  const db = await getDatabase(config.DATABASE_URL);
  res.json(await db.analytics.overview());
});

analyticsRouter.get('/trends', async (req, res) => {
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
analyticsRouter.get('/breakdowns', async (_req, res) => {
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
catalogueRouter.get('/scenarios', (_req, res) => {
  res.json({ scenarios: SCENARIOS, stats: catalogueStats() });
});

catalogueRouter.get('/orders', attachUser, requireRole('agent'), async (_req, res) => {
  const db = await getDatabase(config.DATABASE_URL);
  const orders = db.orders.list();
  const customers = new Map(db.orders.customers().map((c) => [c.id, c]));

  res.json({
    orders: orders.map((o) => ({
      id: o.id,
      status: o.status,
      statusLabel: humanStatus(o.status),
      customerName: customers.get(o.customerId)?.name ?? 'Unknown',
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
});

/** Policy explainer for one order — powers the "why" panel on a case. */
catalogueRouter.get('/orders/:id/policy', attachUser, requireRole('agent'), async (req, res) => {
  const db = await getDatabase(config.DATABASE_URL);
  const result = await db.orders.lookup(req.params.id!);
  if (result.outcome !== 'found') {
    res.status(404).json({ error: `No order matches ${req.params.id}` });
    return;
  }

  res.json({
    order: result.order,
    customer: { name: result.customer.name, city: result.customer.city },
    cancellation: evaluateCancellation(result.order, policy),
    return: assessReturn(result.order),
  });
});

// ── Agora ─────────────────────────────────────────────────────────────────────

export const agoraRouter = Router();

agoraRouter.get('/status', (_req, res) => {
  res.json({
    enabled: agoraService.isConfigured,
    appId: config.agora.appId || null,
    agentId: config.agora.agentId || '9d9ba5ddc6f6448e8bfc1881f13f777c',
    capabilities: {
      voiceRtc: agoraService.isConfigured,
      speechToTextSst: agoraService.isConfigured,
      conversationalAi: agoraService.isConfigured,
      signallingRtm: agoraService.isConfigured,
    },
  });
});

agoraRouter.post('/channel', (req, res) => {
  if (!agoraService.isConfigured) {
    res.status(503).json({
      error: 'Agora is not configured on this deployment.',
      fallback: null,
    });
    return;
  }

  const channelName =
    (typeof req.body?.channelName === 'string' && req.body.channelName.trim()) ||
    `nerv_${Date.now()}`;
  const uid = Number(req.body?.uid ?? 0) || 0;

  try {
    const tokens = agoraService.generateTokens(channelName, uid);
    res.json(tokens);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

agoraRouter.post('/agent/start', async (req, res) => {
  const { channelName, language, greeting } = req.body ?? {};
  if (!channelName) {
    res.status(400).json({ error: 'Missing channelName' });
    return;
  }
  const result = await agoraService.startConversationalAgent(channelName, language ?? 'en', greeting);
  if (!result.ok) {
    res.status(503).json(result);
    return;
  }
  res.json(result);
});

agoraRouter.post('/agent/say', async (req, res) => {
  const { channelName, text } = req.body ?? {};
  if (!channelName || !text) {
    res.status(400).json({ error: 'Missing channelName or text' });
    return;
  }
  const result = await agoraService.speakConversationalAgent(channelName, String(text));
  if (!result.ok) {
    res.status(503).json(result);
    return;
  }
  res.json(result);
});

agoraRouter.post('/agent/stop', async (req, res) => {
  const { channelName, agentName } = req.body ?? {};
  if (!channelName) {
    res.status(400).json({ error: 'Missing channelName' });
    return;
  }
  const result = await agoraService.stopConversationalAgent(channelName, agentName);
  res.json(result);
});

agoraRouter.post('/signalling/publish', (req, res) => {
  const { callId, event, payload } = req.body ?? {};
  if (!callId || !event) {
    res.status(400).json({ error: 'Missing callId or event' });
    return;
  }

  const published = agoraService.publishSignalling(callId, event, payload ?? {});
  res.json({ ok: true, event: published });
});

agoraRouter.get('/signalling/events', (req, res) => {
  const callId = typeof req.query.callId === 'string' ? req.query.callId : undefined;
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 100);
  res.json({ events: agoraService.getRecentEvents(callId, limit) });
});

agoraRouter.get('/signalling/stream', (req, res) => {
  const callId = typeof req.query.callId === 'string' ? req.query.callId : undefined;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify({ event: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  const unsubscribe = agoraService.subscribe((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }, callId);

  req.on('close', () => {
    unsubscribe();
  });
});
