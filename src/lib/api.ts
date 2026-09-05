/**
 * Dashboard API client.
 *
 * Every call goes to the standalone API app, addressed by `VITE_API_URL` — the
 * previous code hardcoded `http://127.0.0.1:3001` in five different files, which
 * is why nothing worked once deployed. `credentials: 'include'` throughout,
 * because the session is an httpOnly cookie.
 */

const BASE =
  (import.meta.env["VITE_API_URL"] as string | undefined)?.replace(/\/$/, "") ??
  (typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? ""
    : "http://localhost:3001");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as
    (Record<string, unknown> & { error?: string }) | null;

  if (!response.ok) {
    throw new ApiError(
      payload?.error ?? `Request failed (${response.status})`,
      response.status,
    );
  }
  return payload as T;
}

const body = (data: unknown): RequestInit => ({ body: JSON.stringify(data) });

// ── Types the dashboard consumes ─────────────────────────────────────────────

export type UserRole = "customer" | "agent" | "supervisor" | "admin";

export interface User {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: UserRole;
  avatarColor: string;
  locale: "en" | "hi";
  theme: "light" | "dark" | "system";
  density: "comfortable" | "compact";
  notifyEscalations: boolean;
  notifyDigest: boolean;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export type TicketStatus =
  "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketCategory =
  "delivery" | "cancellation" | "return" | "refund" | "address" | "general";

export interface Ticket {
  id: string;
  caseRef: string;
  callId: string | null;
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

export interface TicketEvent {
  id: string;
  ticketId: string;
  actorName: string;
  kind:
    | "created"
    | "status_changed"
    | "priority_changed"
    | "assigned"
    | "note"
    | "resolved"
    | "reopened"
    | "escalated";
  fromValue: string | null;
  toValue: string | null;
  body: string | null;
  at: string;
}

export interface TicketStats {
  open: number;
  inProgress: number;
  waitingCustomer: number;
  resolvedToday: number;
  avgResolutionHours: number;
  breachingSla: number;
}

export interface Call {
  id: string;
  caseRef: string;
  callerName: string | null;
  callerPhone: string | null;
  language: "en" | "hi";
  codeSwitched: boolean;
  status: "active" | "completed" | "escalated" | "abandoned";
  intent: string | null;
  orderId: string | null;
  confidenceOverall: number;
  escalated: boolean;
  escalationReason: string | null;
  resolvedBy: "ai" | "human" | null;
  humanRequestCount: number;
  turnCount: number;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
}

export interface TranscriptLine {
  id: string;
  seq: number;
  speaker: "caller" | "agent" | "system" | "human";
  text: string;
  language: "en" | "hi";
  confidence: number;
  at: string;
}

export interface VerificationReport {
  orderId: string | null;
  ordererName: string | null;
  orderStatus: string | null;
  orderTotalInr: number | null;
  identityConfirmed: boolean;
  orderConfirmed: boolean;
  statedReason: string | null;
  policyFindings: string[];
  outstanding: string[];
}

export interface FormattedConversationState {
  intent: {
    key: string;
    label: string;
    confidence: number;
    confidencePercent: number;
  };
  language: {
    primary: "en" | "hi";
    display: string;
    codeSwitched: boolean;
  };
  requiredInfo: {
    problem: boolean;
    customerIdentity: boolean;
    orderId: boolean;
  };
  confirmedFacts: Array<{ label: string; value: string }>;
  unconfirmedFacts: Array<{ label: string; value: string; candidates?: string[] }>;
  confidenceBreakdown: {
    intentPercent: number;
    orderIdPercent: number;
    overallPercent: number;
  };
  attempts: {
    orderId: number;
  };
  decision: "CONTINUE" | "ESCALATE";
}

export interface Escalation {
  id: string;
  caseRef: string;
  callId: string;
  ticketId: string | null;
  customerName: string;
  orderId: string | null;
  reason: string;
  detail: string;
  report: VerificationReport | null;
  aiSummary: string;
  language: "en" | "hi";
  status: "pending" | "accepted" | "resolved";
  priority: TicketPriority;
  assigneeName: string | null;
  confidenceOverall: number;
  createdAt: string;
  acceptedAt: string | null;
  resolvedAt: string | null;
}

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

export interface Assignee {
  id: string;
  name: string;
  role: UserRole;
  avatarColor: string;
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

export const api = {
  baseUrl: BASE,

  health: () =>
    request<{
      status: string;
      persistence: string;
      model: string | null;
      catalogue: { orders: number; customers: number; scenarios: number };
    }>("/health"),

  auth: {
    me: () => request<{ user: User }>("/api/auth/me"),
    login: (email: string, password: string) =>
      request<{ user: User }>("/api/auth/login", {
        method: "POST",
        ...body({ email, password }),
      }),
    signup: (data: {
      email: string;
      password: string;
      fullName: string;
      phone?: string;
    }) =>
      request<{ user: User }>("/api/auth/signup", {
        method: "POST",
        ...body(data),
      }),
    logout: () =>
      request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
    updateProfile: (
      patch: Partial<
        Pick<
          User,
          | "fullName"
          | "phone"
          | "locale"
          | "theme"
          | "density"
          | "avatarColor"
          | "notifyEscalations"
          | "notifyDigest"
        >
      >,
    ) =>
      request<{ user: User }>("/api/auth/me", {
        method: "PATCH",
        ...body(patch),
      }),
    changePassword: (currentPassword: string, newPassword: string) =>
      request<{ ok: boolean; otherSessionsRevoked: number }>(
        "/api/auth/me/password",
        {
          method: "POST",
          ...body({ currentPassword, newPassword }),
        },
      ),
    sessions: () =>
      request<{ sessions: SessionSummary[] }>("/api/auth/me/sessions"),
    revokeSession: (id: string) =>
      request<{ ok: boolean; wasCurrent: boolean }>(
        `/api/auth/me/sessions/${id}`,
        { method: "DELETE" },
      ),
  },

  calls: {
    list: (
      params: {
        status?: string | undefined;
        search?: string | undefined;
        limit?: number | undefined;
        offset?: number | undefined;
      } = {},
    ) =>
      request<{ calls: Call[]; total: number; limit: number; offset: number }>(
        `/api/calls?${query(params)}`,
      ),
    get: (id: string) =>
      request<{ call: Call; transcript: TranscriptLine[] }>(`/api/calls/${id}`),
    live: (id: string) =>
      request<{
        status: string;
        intent: string | null;
        orderId: string | null;
        confidence: number;
        escalated: boolean;
        escalationReason: string | null;
        turnCount: number;
        humanRequestCount: number;
        state: unknown;
        transcript: TranscriptLine[];
      }>(`/api/calls/${id}/live`),
    latestActive: () =>
      request<{
        call: Call | null;
        transcript: Array<{
          id?: string;
          speaker: "caller" | "agent";
          text: string;
          createdAt?: string;
        }>;
      }>("/api/calls/latest/active"),
    transfer: (id: string, reason = "CUSTOMER_INSISTED_HUMAN") =>
      request<{
        ok: boolean;
        caseRef: string;
        reply: string;
        language: string;
        escalated: boolean;
        reason: string;
        step: string;
        stateSummary?: FormattedConversationState;
      }>(`/api/calls/${id}/transfer`, {
        method: "POST",
        ...body({ reason }),
      }),
  },

  tickets: {
    list: (
      params: {
        status?: string | undefined;
        priority?: string | undefined;
        search?: string | undefined;
      } = {},
    ) =>
      request<{ tickets: Ticket[]; total: number; stats: TicketStats }>(
        `/api/tickets?${query(params)}`,
      ),
    get: (id: string) =>
      request<{
        ticket: Ticket;
        events: TicketEvent[];
        transcript: TranscriptLine[];
        order: any;
      }>(`/api/tickets/${id}`),
    create: (data: {
      customerName: string;
      subject: string;
      description?: string;
      category?: TicketCategory;
      priority?: TicketPriority;
      orderId?: string | null;
    }) =>
      request<{ ticket: Ticket }>("/api/tickets", {
        method: "POST",
        ...body(data),
      }),
    update: (
      id: string,
      patch: {
        status?: TicketStatus;
        priority?: TicketPriority;
        assigneeId?: string | null;
        resolution?: string | null;
      },
    ) =>
      request<{ ticket: Ticket }>(`/api/tickets/${id}`, {
        method: "PATCH",
        ...body(patch),
      }),
    addNote: (id: string, text: string) =>
      request<{ event: TicketEvent }>(`/api/tickets/${id}/notes`, {
        method: "POST",
        ...body({ body: text }),
      }),
    assignees: () =>
      request<{ assignees: Assignee[] }>("/api/tickets/meta/assignees"),
  },

  escalations: {
    list: (status?: string) =>
      request<{ escalations: Escalation[] }>(
        `/api/escalations${status ? `?status=${status}` : ""}`,
      ),
    get: (id: string) =>
      request<{
        escalation: Escalation;
        transcript: TranscriptLine[];
        order: any;
      }>(`/api/escalations/${id}`),
    accept: (id: string) =>
      request<{ escalation: Escalation }>(`/api/escalations/${id}/accept`, {
        method: "POST",
      }),
    resolve: (id: string, resolution: string) =>
      request<{ ok: boolean }>(`/api/escalations/${id}/resolve`, {
        method: "POST",
        ...body({ resolution }),
      }),
  },

  analytics: {
    overview: () => request<AnalyticsOverview>("/api/analytics/overview"),
    trends: (days = 14) =>
      request<{ trends: TrendPoint[] }>(`/api/analytics/trends?days=${days}`),
    breakdowns: () =>
      request<{
        intents: Breakdown[];
        escalationReasons: Breakdown[];
        languages: Breakdown[];
      }>("/api/analytics/breakdowns"),
  },

  catalogue: {
    orders: () =>
      request<{ orders: CatalogueOrder[]; total: number }>(
        "/api/catalogue/orders",
      ),
    scenarios: () =>
      request<{
        scenarios: unknown[];
        stats: { orders: number; customers: number };
      }>("/api/catalogue/scenarios"),
  },

  team: {
    list: () => request<{ members: User[] }>("/api/team"),
    update: (id: string, patch: { role?: UserRole; isActive?: boolean }) =>
      request<{ member: User }>(`/api/team/${id}`, {
        method: "PATCH",
        ...body(patch),
      }),
  },
};

export interface CatalogueOrder {
  id: string;
  status: string;
  statusLabel: string;
  customerName: string;
  items: string[];
  totalInr: number;
  paymentMethod: string;
  placedAt: string;
  expectedDeliveryAt: string;
  deliveredAt: string | null;
  city: string;
  courier: string | null;
  trackingId: string | null;
  returnWindowDays: number;
  failedDeliveryAttempts: number;
}

function query(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (
      value === undefined ||
      value === null ||
      value === "" ||
      value === "all"
    )
      continue;
    search.set(key, String(value));
  }
  return search.toString();
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

export function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
