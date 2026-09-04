import { Router } from 'express';
import { z } from 'zod';
import { getDatabase } from '@echosphere/db';
import { endCall, handleTurn, startCall } from '../conversation.js';
import { attachUser, requireRole, type AuthedRequest } from '../auth.js';
import { config } from '../config.js';

/**
 * Call routes.
 *
 * `POST /:id/turn` is the whole voice loop: one caller utterance in, one reply
 * out. This replaced a WebSocket server, which could not run on Vercel — and as
 * it happens a request/response turn is a better fit for a conversation than a
 * socket was, since every turn is naturally a transaction.
 *
 * The three call-progress routes are intentionally unauthenticated so the caller
 * simulator can place a call without an account, exactly as a real phone line
 * would. The read routes below require staff auth.
 */

const router = Router();

router.post('/', async (req, res) => {
  const parsed = z
    .object({
      language: z.enum(['en', 'hi']).optional(),
      channelName: z.string().optional().nullable(),
      callerName: z.string().optional().nullable(),
      callerPhone: z.string().optional().nullable(),
    })
    .safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid call details' });
    return;
  }

  res.status(201).json(await startCall(parsed.data));
});

router.post('/:id/turn', async (req, res) => {
  const parsed = z
    .object({
      text: z.string().min(1, 'Say something first').max(2000),
      asrConfidence: z.number().min(0).max(1).optional(),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid turn' });
    return;
  }

  const result = await handleTurn({
    callId: req.params.id!,
    text: parsed.data.text,
    asrConfidence: parsed.data.asrConfidence,
  });

  if ('error' in result) {
    res.status(result.error === 'Call not found' ? 404 : 400).json({ error: result.error });
    return;
  }

  // The full engine state is useful to the dashboard but noisy for the caller,
  // so the caller-facing payload carries only what it needs to render.
  res.json({
    reply: result.reply,
    language: result.language,
    escalated: result.escalated,
    escalationReason: result.escalationReason,
    caseRef: result.caseRef,
    step: result.step,
    verification: result.state.verification,
    intent: result.state.intent,
    confidence: result.state.confidence.overall,
    humanRequestCount: result.state.humanRequestCount,
  });
});

router.post('/:id/end', async (req, res) => {
  const call = await endCall(req.params.id!);
  if (!call) {
    res.status(404).json({ error: 'Call not found' });
    return;
  }
  res.json({ ok: true, durationSeconds: call.durationSeconds, caseRef: call.caseRef });
});

router.get('/by-channel/:channel', async (req, res) => {
  const db = await getDatabase(config.DATABASE_URL);
  const call = await db.calls.findByChannel(req.params.channel);
  if (!call) {
    res.status(404).json({ error: 'Call not found' });
    return;
  }
  res.json({ callId: call.id, caseRef: call.caseRef, channelName: call.channelName });
});

// ── Staff reads ───────────────────────────────────────────────────────────────

router.get('/', attachUser, requireRole('agent'), async (req, res) => {
  const db = await getDatabase(config.DATABASE_URL);
  const status = req.query.status as 'active' | 'completed' | 'escalated' | 'abandoned' | undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
  const offset = Number(req.query.offset ?? 0) || 0;

  const [calls, total] = await Promise.all([
    db.calls.list({ status: status && status !== ('all' as never) ? status : undefined, search, limit, offset }),
    db.calls.count(status && status !== ('all' as never) ? { status } : undefined),
  ]);

  res.json({
    calls: calls.map((c) => ({ ...c, state: undefined })),
    total,
    limit,
    offset,
  });
});

router.get('/:id', attachUser, requireRole('agent'), async (req, res) => {
  const db = await getDatabase(config.DATABASE_URL);
  const call = await db.calls.findById(req.params.id!);
  if (!call) {
    res.status(404).json({ error: 'Call not found' });
    return;
  }
  const transcript = await db.transcripts.forCall(call.id);
  res.json({ call, transcript });
});

router.get('/:id/transcript', attachUser, requireRole('agent'), async (req, res) => {
  const db = await getDatabase(config.DATABASE_URL);
  res.json({ transcript: await db.transcripts.forCall(req.params.id!) });
});

/**
 * Live view for the console.
 *
 * Polled rather than pushed. Vercel functions cannot hold a socket open, and SSE
 * would burn a function invocation for the duration of every call being watched —
 * for a dashboard, a 2-second poll is cheaper and materially simpler.
 */
router.get('/:id/live', attachUser, requireRole('agent'), async (req: AuthedRequest, res) => {
  const db = await getDatabase(config.DATABASE_URL);
  const call = await db.calls.findById(req.params.id!);
  if (!call) {
    res.status(404).json({ error: 'Call not found' });
    return;
  }
  const transcript = await db.transcripts.forCall(call.id);
  res.json({
    status: call.status,
    intent: call.intent,
    orderId: call.orderId,
    confidence: call.confidenceOverall,
    escalated: call.escalated,
    escalationReason: call.escalationReason,
    turnCount: call.turnCount,
    humanRequestCount: call.humanRequestCount,
    state: call.state,
    transcript,
  });
});

export default router;
