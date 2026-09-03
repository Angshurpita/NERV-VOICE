import type {
  ConversationState,
  EscalationReason,
  IntentKey,
  LanguageCode,
  Order,
  OrderLookupResult,
  VerificationReport,
} from '@echosphere/core';
import { CUSTOMERS, findCustomer, findOrder, ORDERS, OUTAGE_ORDER_IDS } from './catalogue.js';
import { cryptoRandomId, type Store, type Where } from './store.js';
import {
  TABLES,
  type AnalyticsOverview,
  type Breakdown,
  type CallRow,
  type CallStatus,
  type EscalationRow,
  type PublicUser,
  type SessionRow,
  type TicketCategory,
  type TicketEventKind,
  type TicketEventRow,
  type TicketPriority,
  type TicketRow,
  type TicketStatus,
  type TranscriptRow,
  type TrendPoint,
  type UserRow,
} from './types.js';

/**
 * Repositories.
 *
 * One implementation, two backends — see `store.ts`. Anything that needs a real
 * aggregate tries `raw` SQL first and falls back to computing in TypeScript, so
 * the analytics page works identically against Postgres and the in-memory store.
 */

const now = () => new Date().toISOString();

// ── Orders (catalogue-backed) ────────────────────────────────────────────────

/**
 * The order catalogue is reference data, so reads are served from memory rather
 * than the database — it is a fixed list, and a voice call cannot afford a round
 * trip per lookup. Mutations (a cancellation) are applied to the in-process copy
 * and mirrored to Postgres when configured.
 */
export class OrderRepository {
  private overrides = new Map<string, Partial<Order>>();

  constructor(private readonly store: Store) {}

  /**
   * Look an order up.
   *
   * Ownership is deliberately *not* enforced here. The caller on a support line
   * has not authenticated as a customer — the whole point of requirement 7 is
   * that identity is established by matching the name on the order during the
   * read-back, so the lookup returns the order plus its owner and
   * `verification.ts` decides whether the caller may hear about it.
   */
  async lookup(orderId: string): Promise<OrderLookupResult> {
    const id = orderId.trim();

    if (OUTAGE_ORDER_IDS.has(id)) {
      return { outcome: 'backend_unavailable', orderId: id };
    }

    const base = findOrder(id);
    if (!base) return { outcome: 'not_found', orderId: id };

    const order = { ...base, ...this.overrides.get(base.id) };
    const customer = findCustomer(order.customerId);
    if (!customer) return { outcome: 'not_found', orderId: id };

    return { outcome: 'found', order, customer };
  }

  async cancel(orderId: string): Promise<boolean> {
    const result = await this.lookup(orderId);
    if (result.outcome !== 'found') return false;

    this.overrides.set(result.order.id, {
      status: 'CANCELLED',
      cancelledAt: now().slice(0, 10),
      history: [
        ...result.order.history,
        { status: 'CANCELLED', at: now().slice(0, 10), note: 'Cancelled by AI agent on caller request' },
      ],
    });

    if (this.store.supportsRaw()) {
      await this.store
        .raw(`UPDATE orders SET status = $1, cancelled_at = now() WHERE id = $2`, ['CANCELLED', result.order.id])
        .catch(() => []);
    }
    return true;
  }

  list(): readonly Order[] {
    return ORDERS.map((o) => ({ ...o, ...this.overrides.get(o.id) }));
  }

  customers() {
    return CUSTOMERS;
  }
}

// ── Users ─────────────────────────────────────────────────────────────────────

export class UserRepository {
  constructor(private readonly store: Store) {}

  async create(input: {
    email: string;
    passwordHash: string;
    fullName: string;
    phone?: string | null;
    role?: UserRow['role'];
  }): Promise<UserRow> {
    return this.store.insert<UserRow>(TABLES.users, {
      id: cryptoRandomId(),
      email: input.email.toLowerCase().trim(),
      passwordHash: input.passwordHash,
      fullName: input.fullName.trim(),
      phone: input.phone ?? null,
      role: input.role ?? 'agent',
      avatarColor: pickAvatarColor(input.email),
      locale: 'en',
      theme: 'light',
      density: 'comfortable',
      notifyEscalations: true,
      notifyDigest: false,
      isActive: true,
      createdAt: now(),
      lastLoginAt: null,
    });
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const rows = await this.store.findMany<UserRow>(
      TABLES.users,
      { email: email.toLowerCase().trim() },
      { limit: 1 },
    );
    return rows[0] ?? null;
  }

  findById(id: string): Promise<UserRow | null> {
    return this.store.findById<UserRow>(TABLES.users, id);
  }

  update(id: string, patch: Partial<UserRow>): Promise<UserRow | null> {
    return this.store.update<UserRow>(TABLES.users, id, patch);
  }

  async markLogin(id: string): Promise<void> {
    await this.store.update<UserRow>(TABLES.users, id, { lastLoginAt: now() });
  }

  async list(): Promise<UserRow[]> {
    return this.store.findMany<UserRow>(TABLES.users, undefined, {
      orderBy: { column: 'createdAt', direction: 'asc' },
    });
  }

  async count(): Promise<number> {
    return this.store.count(TABLES.users);
  }
}

const AVATAR_COLORS = ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet', 'teal', 'orange'];

function pickAvatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 997;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

export function toPublicUser(user: UserRow): PublicUser {
  const { passwordHash: _omit, ...rest } = user;
  return rest;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export class SessionRepository {
  constructor(private readonly store: Store) {}

  create(input: {
    /** Supplied by the caller so the id can be embedded in the token itself, which is what makes revoking a single device possible without a blacklist. */
    id?: string;
    userId: string;
    tokenHash: string;
    userAgent?: string | null;
    ip?: string | null;
    ttlDays: number;
  }): Promise<SessionRow> {
    const expires = new Date();
    expires.setDate(expires.getDate() + input.ttlDays);

    return this.store.insert<SessionRow>(TABLES.sessions, {
      id: input.id ?? cryptoRandomId(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
      createdAt: now(),
      lastSeenAt: now(),
      expiresAt: expires.toISOString(),
      revokedAt: null,
    });
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    const rows = await this.store.findMany<SessionRow>(TABLES.sessions, { tokenHash }, { limit: 1 });
    const session = rows[0];
    if (!session) return null;
    if (session.revokedAt) return null;
    if (new Date(session.expiresAt).getTime() < Date.now()) return null;
    return session;
  }

  async touch(id: string): Promise<void> {
    await this.store.update<SessionRow>(TABLES.sessions, id, { lastSeenAt: now() });
  }

  async listActive(userId: string): Promise<SessionRow[]> {
    const rows = await this.store.findMany<SessionRow>(TABLES.sessions, { userId }, {
      orderBy: { column: 'lastSeenAt', direction: 'desc' },
    });
    return rows.filter((s) => !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now());
  }

  async revoke(id: string): Promise<boolean> {
    const updated = await this.store.update<SessionRow>(TABLES.sessions, id, { revokedAt: now() });
    return updated !== null;
  }

  async revokeAllForUser(userId: string, except?: string): Promise<number> {
    const sessions = await this.listActive(userId);
    let n = 0;
    for (const s of sessions) {
      if (s.id === except) continue;
      await this.revoke(s.id);
      n++;
    }
    return n;
  }
}

// ── Case references ───────────────────────────────────────────────────────────

/**
 * Human-facing reference, e.g. `ECH-2026-000042`.
 *
 * Sequential rather than random because these get read aloud on calls and typed
 * into spreadsheets, and "E C H two zero two six zero zero zero zero four two"
 * is already a mouthful without a UUID.
 */
async function nextCaseRef(store: Store, table: string): Promise<string> {
  const year = new Date().getFullYear();
  const total = await store.count(table);
  return `ECH-${year}-${String(total + 1).padStart(6, '0')}`;
}

// ── Calls ─────────────────────────────────────────────────────────────────────

export class CallRepository {
  constructor(private readonly store: Store) {}

  async create(input: {
    language: LanguageCode;
    channelName?: string | null;
    callerName?: string | null;
    callerPhone?: string | null;
    state: ConversationState;
  }): Promise<CallRow> {
    return this.store.insert<CallRow>(TABLES.calls, {
      id: cryptoRandomId(),
      caseRef: await nextCaseRef(this.store, TABLES.calls),
      customerId: null,
      callerName: input.callerName ?? null,
      callerPhone: input.callerPhone ?? null,
      channelName: input.channelName ?? null,
      language: input.language,
      codeSwitched: false,
      status: 'active',
      intent: null,
      orderId: null,
      confidenceOverall: 0,
      escalated: false,
      escalationReason: null,
      resolvedBy: null,
      humanRequestCount: 0,
      turnCount: 0,
      startedAt: now(),
      endedAt: null,
      durationSeconds: null,
      state: input.state as unknown,
    });
  }

  findById(id: string): Promise<CallRow | null> {
    return this.store.findById<CallRow>(TABLES.calls, id);
  }

  /** Persist the engine state plus the denormalised columns the dashboard reads. */
  async syncFromState(id: string, state: ConversationState): Promise<CallRow | null> {
    return this.store.update<CallRow>(TABLES.calls, id, {
      state: state as unknown,
      intent: state.intent.value === 'unknown' ? null : (state.intent.value as IntentKey),
      orderId: state.verification.orderId,
      customerId: state.customer.id,
      callerName: state.verification.ordererName ?? state.customer.name,
      language: state.language.primary,
      codeSwitched: state.language.codeSwitched,
      confidenceOverall: state.confidence.overall,
      humanRequestCount: state.humanRequestCount,
      turnCount: state.turnCount,
      escalated: state.escalation.required,
      escalationReason: state.escalation.reason,
      status: state.escalation.required ? 'escalated' : 'active',
    });
  }

  async end(id: string, resolvedBy: CallRow['resolvedBy']): Promise<CallRow | null> {
    const call = await this.findById(id);
    if (!call) return null;
    const ended = new Date();
    const duration = Math.max(
      0,
      Math.round((ended.getTime() - new Date(call.startedAt).getTime()) / 1000),
    );
    return this.store.update<CallRow>(TABLES.calls, id, {
      status: call.escalated ? 'escalated' : 'completed',
      endedAt: ended.toISOString(),
      durationSeconds: duration,
      resolvedBy: resolvedBy ?? (call.escalated ? 'human' : 'ai'),
    });
  }

  async list(filter: { status?: CallStatus; search?: string; limit?: number; offset?: number } = {}) {
    const where: Where = {};
    if (filter.status) (where as Record<string, string>).status = filter.status;

    const rows = await this.store.findMany<CallRow>(TABLES.calls, where, {
      orderBy: { column: 'startedAt', direction: 'desc' },
      limit: filter.limit ?? 50,
      offset: filter.offset ?? 0,
    });

    const search = filter.search?.trim().toLowerCase();
    if (!search) return rows;
    return rows.filter(
      (r) =>
        r.caseRef.toLowerCase().includes(search) ||
        (r.callerName ?? '').toLowerCase().includes(search) ||
        (r.orderId ?? '').toLowerCase().includes(search),
    );
  }

  count(where?: Where): Promise<number> {
    return this.store.count(TABLES.calls, where);
  }

  all(): Promise<CallRow[]> {
    return this.store.findMany<CallRow>(TABLES.calls);
  }
}

// ── Transcripts ───────────────────────────────────────────────────────────────

export class TranscriptRepository {
  constructor(private readonly store: Store) {}

  async append(input: {
    callId: string;
    speaker: TranscriptRow['speaker'];
    text: string;
    language: LanguageCode;
    confidence?: number;
  }): Promise<TranscriptRow> {
    const existing = await this.store.count(TABLES.transcripts, { callId: input.callId });
    return this.store.insert<TranscriptRow>(TABLES.transcripts, {
      id: cryptoRandomId(),
      callId: input.callId,
      seq: existing + 1,
      speaker: input.speaker,
      text: input.text,
      language: input.language,
      confidence: input.confidence ?? 1,
      at: now(),
    });
  }

  async forCall(callId: string): Promise<TranscriptRow[]> {
    return this.store.findMany<TranscriptRow>(TABLES.transcripts, { callId }, {
      orderBy: { column: 'seq', direction: 'asc' },
    });
  }
}

// ── Tickets ───────────────────────────────────────────────────────────────────

/** Transitions a ticket is allowed to make. Anything else is rejected. */
const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ['in_progress', 'waiting_customer', 'resolved', 'closed'],
  in_progress: ['waiting_customer', 'resolved', 'open'],
  waiting_customer: ['in_progress', 'resolved', 'closed'],
  resolved: ['closed', 'in_progress'],
  closed: ['in_progress'],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return from === to || (TICKET_TRANSITIONS[from] ?? []).includes(to);
}

const SLA_HOURS: Record<TicketPriority, number> = { urgent: 2, high: 8, medium: 24, low: 72 };

export class TicketRepository {
  constructor(private readonly store: Store) {}

  async create(input: {
    callId?: string | null;
    customerId?: string | null;
    customerName: string;
    orderId?: string | null;
    subject: string;
    description: string;
    category: TicketCategory;
    priority: TicketPriority;
    actorName?: string;
  }): Promise<TicketRow> {
    const sla = new Date();
    sla.setHours(sla.getHours() + SLA_HOURS[input.priority]);

    const ticket = await this.store.insert<TicketRow>(TABLES.tickets, {
      id: cryptoRandomId(),
      caseRef: await nextCaseRef(this.store, TABLES.tickets),
      callId: input.callId ?? null,
      customerId: input.customerId ?? null,
      customerName: input.customerName,
      orderId: input.orderId ?? null,
      subject: input.subject,
      description: input.description,
      category: input.category,
      status: 'open',
      priority: input.priority,
      assigneeId: null,
      assigneeName: null,
      slaDueAt: sla.toISOString(),
      resolution: null,
      createdAt: now(),
      updatedAt: now(),
      resolvedAt: null,
      closedAt: null,
    });

    await this.addEvent(ticket.id, {
      actorId: null,
      actorName: input.actorName ?? 'AI agent',
      kind: 'created',
      body: input.description,
    });

    return ticket;
  }

  findById(id: string): Promise<TicketRow | null> {
    return this.store.findById<TicketRow>(TABLES.tickets, id);
  }

  async findByCallId(callId: string): Promise<TicketRow | null> {
    const rows = await this.store.findMany<TicketRow>(TABLES.tickets, { callId }, { limit: 1 });
    return rows[0] ?? null;
  }

  async list(filter: {
    status?: TicketStatus;
    priority?: TicketPriority;
    assigneeId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    const where: Record<string, string> = {};
    if (filter.status) where.status = filter.status;
    if (filter.priority) where.priority = filter.priority;
    if (filter.assigneeId) where.assigneeId = filter.assigneeId;

    const rows = await this.store.findMany<TicketRow>(TABLES.tickets, where, {
      orderBy: { column: 'updatedAt', direction: 'desc' },
      limit: filter.limit ?? 100,
      offset: filter.offset ?? 0,
    });

    const search = filter.search?.trim().toLowerCase();
    if (!search) return rows;
    return rows.filter(
      (t) =>
        t.caseRef.toLowerCase().includes(search) ||
        t.customerName.toLowerCase().includes(search) ||
        t.subject.toLowerCase().includes(search) ||
        (t.orderId ?? '').toLowerCase().includes(search),
    );
  }

  /**
   * Apply a change, recording history.
   *
   * Rejects illegal transitions and refuses to resolve without a resolution note
   * — the two rules that turn a status field into an actual workflow.
   */
  async applyChange(
    id: string,
    patch: {
      status?: TicketStatus;
      priority?: TicketPriority;
      assigneeId?: string | null;
      assigneeName?: string | null;
      resolution?: string | null;
    },
    actor: { id: string | null; name: string },
  ): Promise<{ ok: true; ticket: TicketRow } | { ok: false; error: string }> {
    const existing = await this.findById(id);
    if (!existing) return { ok: false, error: 'Ticket not found' };

    const events: Array<Parameters<TicketRepository['addEvent']>[1]> = [];
    const update: Partial<TicketRow> = { updatedAt: now() };

    if (patch.status && patch.status !== existing.status) {
      if (!canTransition(existing.status, patch.status)) {
        return {
          ok: false,
          error: `Cannot move a ticket from ${existing.status} to ${patch.status}.`,
        };
      }
      if (patch.status === 'resolved' && !(patch.resolution ?? existing.resolution)) {
        return { ok: false, error: 'A resolution note is required before resolving a ticket.' };
      }
      update.status = patch.status;
      if (patch.status === 'resolved') update.resolvedAt = now();
      if (patch.status === 'closed') update.closedAt = now();
      if (patch.status === 'in_progress') {
        update.resolvedAt = null;
        update.closedAt = null;
      }
      events.push({
        actorId: actor.id,
        actorName: actor.name,
        kind: patch.status === 'resolved' ? 'resolved' : patch.status === 'in_progress' && existing.status === 'closed' ? 'reopened' : 'status_changed',
        fromValue: existing.status,
        toValue: patch.status,
      });
    }

    if (patch.priority && patch.priority !== existing.priority) {
      update.priority = patch.priority;
      const sla = new Date();
      sla.setHours(sla.getHours() + SLA_HOURS[patch.priority]);
      update.slaDueAt = sla.toISOString();
      events.push({
        actorId: actor.id,
        actorName: actor.name,
        kind: 'priority_changed',
        fromValue: existing.priority,
        toValue: patch.priority,
      });
    }

    if (patch.assigneeId !== undefined && patch.assigneeId !== existing.assigneeId) {
      update.assigneeId = patch.assigneeId;
      update.assigneeName = patch.assigneeName ?? null;
      events.push({
        actorId: actor.id,
        actorName: actor.name,
        kind: 'assigned',
        fromValue: existing.assigneeName,
        toValue: patch.assigneeName ?? 'Unassigned',
      });
    }

    if (patch.resolution !== undefined && patch.resolution !== existing.resolution) {
      update.resolution = patch.resolution;
    }

    const ticket = await this.store.update<TicketRow>(TABLES.tickets, id, update);
    if (!ticket) return { ok: false, error: 'Ticket not found' };

    for (const event of events) await this.addEvent(id, event);
    return { ok: true, ticket };
  }

  addEvent(
    ticketId: string,
    input: {
      actorId: string | null;
      actorName: string;
      kind: TicketEventKind;
      fromValue?: string | null;
      toValue?: string | null;
      body?: string | null;
    },
  ): Promise<TicketEventRow> {
    return this.store.insert<TicketEventRow>(TABLES.ticketEvents, {
      id: cryptoRandomId(),
      ticketId,
      actorId: input.actorId,
      actorName: input.actorName,
      kind: input.kind,
      fromValue: input.fromValue ?? null,
      toValue: input.toValue ?? null,
      body: input.body ?? null,
      at: now(),
    });
  }

  async events(ticketId: string): Promise<TicketEventRow[]> {
    return this.store.findMany<TicketEventRow>(TABLES.ticketEvents, { ticketId }, {
      orderBy: { column: 'at', direction: 'asc' },
    });
  }

  all(): Promise<TicketRow[]> {
    return this.store.findMany<TicketRow>(TABLES.tickets);
  }

  count(where?: Where): Promise<number> {
    return this.store.count(TABLES.tickets, where);
  }
}

// ── Escalations ───────────────────────────────────────────────────────────────

export class EscalationRepository {
  constructor(private readonly store: Store) {}

  async create(input: {
    callId: string;
    ticketId: string | null;
    customerName: string;
    orderId: string | null;
    reason: EscalationReason;
    detail: string;
    report: VerificationReport | null;
    aiSummary: string;
    language: LanguageCode;
    priority: TicketPriority;
    confidenceOverall: number;
  }): Promise<EscalationRow> {
    return this.store.insert<EscalationRow>(TABLES.escalations, {
      id: cryptoRandomId(),
      caseRef: await nextCaseRef(this.store, TABLES.escalations),
      callId: input.callId,
      ticketId: input.ticketId,
      customerName: input.customerName,
      orderId: input.orderId,
      reason: input.reason,
      detail: input.detail,
      report: input.report,
      aiSummary: input.aiSummary,
      language: input.language,
      status: 'pending',
      priority: input.priority,
      assigneeId: null,
      assigneeName: null,
      confidenceOverall: input.confidenceOverall,
      createdAt: now(),
      acceptedAt: null,
      resolvedAt: null,
    });
  }

  findById(id: string): Promise<EscalationRow | null> {
    return this.store.findById<EscalationRow>(TABLES.escalations, id);
  }

  async list(status?: EscalationRow['status']): Promise<EscalationRow[]> {
    return this.store.findMany<EscalationRow>(
      TABLES.escalations,
      status ? { status } : undefined,
      { orderBy: { column: 'createdAt', direction: 'desc' } },
    );
  }

  accept(id: string, agent: { id: string; name: string }): Promise<EscalationRow | null> {
    return this.store.update<EscalationRow>(TABLES.escalations, id, {
      status: 'accepted',
      assigneeId: agent.id,
      assigneeName: agent.name,
      acceptedAt: now(),
    });
  }

  resolve(id: string): Promise<EscalationRow | null> {
    return this.store.update<EscalationRow>(TABLES.escalations, id, {
      status: 'resolved',
      resolvedAt: now(),
    });
  }

  count(where?: Where): Promise<number> {
    return this.store.count(TABLES.escalations, where);
  }

  all(): Promise<EscalationRow[]> {
    return this.store.findMany<EscalationRow>(TABLES.escalations);
  }
}

// ── Analytics ─────────────────────────────────────────────────────────────────

/**
 * Analytics computed from real rows.
 *
 * Every number here is derived; when there are no calls yet the result is zeros
 * and the UI shows an empty state. That is the point — the previous version
 * displayed invented traffic, which made the dashboard impossible to trust.
 */
export class AnalyticsRepository {
  constructor(
    private readonly calls: CallRepository,
    private readonly tickets: TicketRepository,
    private readonly escalations: EscalationRepository,
  ) {}

  async overview(): Promise<AnalyticsOverview> {
    const [calls, tickets] = await Promise.all([this.calls.all(), this.tickets.all()]);

    const finished = calls.filter((c) => c.endedAt !== null);
    const aiResolved = calls.filter((c) => c.resolvedBy === 'ai').length;
    const escalated = calls.filter((c) => c.escalated).length;
    const durations = finished.map((c) => c.durationSeconds ?? 0).filter((d) => d > 0);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const resolvedToday = tickets.filter(
      (t) => t.resolvedAt && new Date(t.resolvedAt) >= todayStart,
    ).length;

    const resolutionHours = tickets
      .filter((t) => t.resolvedAt)
      .map((t) => (new Date(t.resolvedAt!).getTime() - new Date(t.createdAt).getTime()) / 3_600_000);

    return {
      totalCalls: calls.length,
      activeCalls: calls.filter((c) => c.status === 'active').length,
      aiResolvedPercent: pct(aiResolved, calls.length),
      escalatedPercent: pct(escalated, calls.length),
      avgHandleSeconds: Math.round(mean(durations)),
      openTickets: tickets.filter((t) => t.status === 'open').length,
      inProgressTickets: tickets.filter((t) => t.status === 'in_progress').length,
      resolvedToday,
      avgResolutionHours: round1(mean(resolutionHours)),
      containmentRate: pct(calls.length - escalated, calls.length),
    };
  }

  async trends(days = 14): Promise<TrendPoint[]> {
    const calls = await this.calls.all();
    const buckets = new Map<string, TrendPoint>();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { date: key, total: 0, aiResolved: 0, humanResolved: 0, escalated: 0 });
    }

    for (const call of calls) {
      const key = call.startedAt.slice(0, 10);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      bucket.total++;
      if (call.escalated) bucket.escalated++;
      if (call.resolvedBy === 'ai') bucket.aiResolved++;
      if (call.resolvedBy === 'human') bucket.humanResolved++;
    }

    return [...buckets.values()];
  }

  async topIntents(): Promise<Breakdown[]> {
    const calls = await this.calls.all();
    return tally(calls.map((c) => c.intent).filter((i): i is IntentKey => Boolean(i)));
  }

  async escalationReasons(): Promise<Breakdown[]> {
    const rows = await this.escalations.all();
    return tally(rows.map((e) => e.reason));
  }

  async languageMix(): Promise<Breakdown[]> {
    const calls = await this.calls.all();
    const mix = { Hindi: 0, English: 0, 'Code-switched': 0 };
    for (const call of calls) {
      if (call.codeSwitched) mix['Code-switched']++;
      else if (call.language === 'hi') mix.Hindi++;
      else mix.English++;
    }
    return Object.entries(mix)
      .map(([name, value]) => ({ name, value }))
      .filter((b) => b.value > 0);
  }
}

function tally(values: string[]): Breakdown[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function pct(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
