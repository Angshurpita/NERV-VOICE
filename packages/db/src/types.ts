/**
 * Persistence row types.
 *
 * Deliberately flat and snake_case-free at the TypeScript boundary: the store
 * maps column names, so callers never see `created_at`. Order and customer
 * shapes come from `@echosphere/core` rather than being redefined here, so the
 * conversation engine and the database cannot drift apart.
 */

import type {
  EscalationReason,
  IntentKey,
  LanguageCode,
  VerificationReport,
} from '@echosphere/core';

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * Roles, narrowest first.
 *
 * `customer` exists so the caller app can authenticate real people; it must
 * never reach the staff dashboard, which is enforced in the API middleware
 * rather than by hiding nav links.
 */
export type UserRole = 'customer' | 'agent' | 'supervisor' | 'admin';

export interface UserRow {
  id: string;
  email: string;
  /** bcrypt hash. Never leaves the repository layer. */
  passwordHash: string;
  fullName: string;
  phone: string | null;
  role: UserRole;
  /** Tailwind-ish token for the avatar, chosen at signup. */
  avatarColor: string;
  locale: LanguageCode;
  theme: 'light' | 'dark' | 'system';
  density: 'comfortable' | 'compact';
  notifyEscalations: boolean;
  notifyDigest: boolean;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

/** What the client is allowed to see. */
export type PublicUser = Omit<UserRow, 'passwordHash'>;

export interface SessionRow {
  id: string;
  userId: string;
  /** SHA-256 of the JWT, so a leaked table cannot be replayed as tokens. */
  tokenHash: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

// ── Calls ─────────────────────────────────────────────────────────────────────

export type CallStatus = 'active' | 'completed' | 'escalated' | 'abandoned';
export type ResolvedBy = 'ai' | 'human' | null;

export interface CallRow {
  id: string;
  /** Human-facing reference, e.g. ECH-2026-000042. */
  caseRef: string;
  customerId: string | null;
  callerName: string | null;
  callerPhone: string | null;
  channelName: string | null;
  agentId: string | null;
  agentRtcUid: number | null;
  language: LanguageCode;
  codeSwitched: boolean;
  status: CallStatus;
  intent: IntentKey | null;
  orderId: string | null;
  confidenceOverall: number;
  escalated: boolean;
  escalationReason: EscalationReason | null;
  resolvedBy: ResolvedBy;
  humanRequestCount: number;
  turnCount: number;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  /** Serialised ConversationState, so a call can be resumed or replayed. */
  state: unknown;
}

export interface TranscriptRow {
  id: string;
  callId: string;
  seq: number;
  speaker: 'caller' | 'agent' | 'system' | 'human';
  text: string;
  language: LanguageCode;
  confidence: number;
  at: string;
}

// ── Tickets ───────────────────────────────────────────────────────────────────

export type TicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketCategory =
  | 'delivery'
  | 'cancellation'
  | 'return'
  | 'refund'
  | 'address'
  | 'general';

export interface TicketRow {
  id: string;
  caseRef: string;
  callId: string | null;
  customerId: string | null;
  customerName: string;
  orderId: string | null;
  subject: string;
  description: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  slaDueAt: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
}

export type TicketEventKind =
  | 'created'
  | 'status_changed'
  | 'priority_changed'
  | 'assigned'
  | 'note'
  | 'resolved'
  | 'reopened'
  | 'escalated';

/**
 * Append-only ticket history.
 *
 * The detail timeline is built from these rows rather than from mutable fields,
 * so "who changed what, when" survives every later edit.
 */
export interface TicketEventRow {
  id: string;
  ticketId: string;
  actorId: string | null;
  actorName: string;
  kind: TicketEventKind;
  fromValue: string | null;
  toValue: string | null;
  body: string | null;
  at: string;
}

// ── Escalations ───────────────────────────────────────────────────────────────

export type EscalationStatus = 'pending' | 'accepted' | 'resolved';

export interface EscalationRow {
  id: string;
  caseRef: string;
  callId: string;
  ticketId: string | null;
  customerName: string;
  orderId: string | null;
  reason: EscalationReason;
  detail: string;
  /** The verification file the AI assembled before handing over (req 6.2). */
  report: VerificationReport | null;
  aiSummary: string;
  language: LanguageCode;
  status: EscalationStatus;
  priority: TicketPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  confidenceOverall: number;
  createdAt: string;
  acceptedAt: string | null;
  resolvedAt: string | null;
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export interface AnalyticsOverview {
  totalCalls: number;
  activeCalls: number;
  aiResolvedPercent: number;
  escalatedPercent: number;
  avgHandleSeconds: number;
  openTickets: number;
  inProgressTickets: number;
  resolvedToday: number;
  avgResolutionHours: number;
  containmentRate: number;
}

export interface TrendPoint {
  date: string;
  total: number;
  aiResolved: number;
  humanResolved: number;
  escalated: number;
}

export interface Breakdown {
  name: string;
  value: number;
}

// ── Table registry ────────────────────────────────────────────────────────────

export const TABLES = {
  users: 'users',
  sessions: 'sessions',
  calls: 'calls',
  transcripts: 'transcripts',
  tickets: 'tickets',
  ticketEvents: 'ticket_events',
  escalations: 'escalations',
} as const;

export type TableName = (typeof TABLES)[keyof typeof TABLES];
