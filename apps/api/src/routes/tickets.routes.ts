import { Router } from "express";
import { z } from "zod";
import { getDatabase, toPublicUser } from "@echosphere/db";
import { attachUser, requireRole, type AuthedRequest } from "../auth.js";
import { config } from "../config.js";

/**
 * Ticket routes — requirement 3, "make the ticketing system work".
 *
 * The previous UI had selects and an "Add Note" button with no handlers behind
 * them. The workflow rules (legal transitions, resolution notes) live in
 * `TicketRepository.applyChange`, so they hold regardless of which client calls.
 */

const router = Router();
router.use(attachUser, requireRole("agent"));

const STATUSES = [
  "open",
  "in_progress",
  "waiting_customer",
  "resolved",
  "closed",
] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const CATEGORIES = [
  "delivery",
  "cancellation",
  "return",
  "refund",
  "address",
  "general",
] as const;

router.get("/", async (req, res) => {
  const db = await getDatabase(config.DATABASE_URL);
  const status = STATUSES.find((s) => s === req.query.status);
  const priority = PRIORITIES.find((p) => p === req.query.priority);

  const tickets = await db.tickets.list({
    status,
    priority,
    search: typeof req.query.search === "string" ? req.query.search : undefined,
    limit: Math.min(Number(req.query.limit ?? 100) || 100, 300),
    offset: Number(req.query.offset ?? 0) || 0,
  });

  const all = await db.tickets.all();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const resolutionHours = all
    .filter((t) => t.resolvedAt)
    .map(
      (t) =>
        (new Date(t.resolvedAt!).getTime() - new Date(t.createdAt).getTime()) /
        3_600_000,
    );

  res.json({
    tickets,
    total: all.length,
    // Computed, not invented — an empty install reports zeros.
    stats: {
      open: all.filter((t) => t.status === "open").length,
      inProgress: all.filter((t) => t.status === "in_progress").length,
      waitingCustomer: all.filter((t) => t.status === "waiting_customer")
        .length,
      resolvedToday: all.filter(
        (t) => t.resolvedAt && new Date(t.resolvedAt) >= todayStart,
      ).length,
      avgResolutionHours:
        resolutionHours.length === 0
          ? 0
          : Math.round(
              (resolutionHours.reduce((a, b) => a + b, 0) /
                resolutionHours.length) *
                10,
            ) / 10,
      breachingSla: all.filter(
        (t) =>
          t.slaDueAt &&
          !t.resolvedAt &&
          !t.closedAt &&
          new Date(t.slaDueAt).getTime() < Date.now(),
      ).length,
    },
  });
});

router.get("/:id", async (req, res) => {
  const db = await getDatabase(config.DATABASE_URL);
  const ticket = await db.tickets.findById(req.params.id!);
  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  const [events, transcript] = await Promise.all([
    db.tickets.events(ticket.id),
    ticket.callId ? db.transcripts.forCall(ticket.callId) : Promise.resolve([]),
  ]);

  const order = ticket.orderId ? await db.orders.lookup(ticket.orderId) : null;

  res.json({
    ticket,
    events,
    transcript,
    order: order?.outcome === "found" ? order.order : null,
  });
});

router.post("/", async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      customerName: z.string().min(2, "Customer name is required"),
      subject: z.string().min(3, "Give the ticket a subject"),
      description: z.string().default(""),
      category: z.enum(CATEGORIES).default("general"),
      priority: z.enum(PRIORITIES).default("medium"),
      orderId: z.string().optional().nullable(),
      callId: z.string().optional().nullable(),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid ticket" });
    return;
  }

  const db = await getDatabase(config.DATABASE_URL);
  const ticket = await db.tickets.create({
    ...parsed.data,
    actorName: req.user!.fullName,
  });
  res.status(201).json({ ticket });
});

router.patch("/:id", async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      status: z.enum(STATUSES).optional(),
      priority: z.enum(PRIORITIES).optional(),
      assigneeId: z.string().nullable().optional(),
      resolution: z.string().nullable().optional(),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid change" });
    return;
  }

  const db = await getDatabase(config.DATABASE_URL);

  // Resolve the assignee's name here so the ticket row stays readable without a
  // join, and so the history entry records who it actually went to.
  let assigneeName: string | null | undefined;
  if (parsed.data.assigneeId !== undefined) {
    if (parsed.data.assigneeId === null) {
      assigneeName = null;
    } else {
      const assignee = await db.users.findById(parsed.data.assigneeId);
      if (!assignee) {
        res.status(400).json({ error: "That team member does not exist." });
        return;
      }
      assigneeName = assignee.fullName;
    }
  }

  const result = await db.tickets.applyChange(
    req.params.id!,
    { ...parsed.data, assigneeName },
    { id: req.user!.id, name: req.user!.fullName },
  );

  if (!result.ok) {
    res
      .status(result.error === "Ticket not found" ? 404 : 422)
      .json({ error: result.error });
    return;
  }
  res.json({ ticket: result.ticket });
});

router.post("/:id/notes", async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ body: z.string().min(1, "Write something first") })
    .safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid note" });
    return;
  }

  const db = await getDatabase(config.DATABASE_URL);
  const ticket = await db.tickets.findById(req.params.id!);
  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  const event = await db.tickets.addEvent(ticket.id, {
    actorId: req.user!.id,
    actorName: req.user!.fullName,
    kind: "note",
    body: parsed.data.body,
  });

  await db.store.update("tickets", ticket.id, {
    updatedAt: new Date().toISOString(),
  });
  res.status(201).json({ event });
});

/** Assignable staff, for the assignee dropdown. */
router.get("/meta/assignees", async (_req, res) => {
  const db = await getDatabase(config.DATABASE_URL);
  const users = await db.users.list();
  res.json({
    assignees: users
      .filter((u) => u.isActive && u.role !== "customer")
      .map((u) => ({
        id: u.id,
        name: u.fullName,
        role: u.role,
        avatarColor: u.avatarColor,
      })),
  });
});

export default router;

// ── Escalations ───────────────────────────────────────────────────────────────

export const escalationRouter = Router();
escalationRouter.use(attachUser, requireRole("agent"));

escalationRouter.get("/", async (req, res) => {
  const db = await getDatabase(config.DATABASE_URL);
  const status = ["pending", "accepted", "resolved"].find(
    (s) => s === req.query.status,
  ) as "pending" | "accepted" | "resolved" | undefined;
  res.json({ escalations: await db.escalations.list(status) });
});

escalationRouter.get("/:id", async (req, res) => {
  const db = await getDatabase(config.DATABASE_URL);
  const escalation = await db.escalations.findById(req.params.id!);
  if (!escalation) {
    res.status(404).json({ error: "Escalation not found" });
    return;
  }
  const transcript = await db.transcripts.forCall(escalation.callId);
  const order = escalation.orderId
    ? await db.orders.lookup(escalation.orderId)
    : null;
  res.json({
    escalation,
    transcript,
    order: order?.outcome === "found" ? order.order : null,
  });
});

escalationRouter.post("/:id/accept", async (req: AuthedRequest, res) => {
  const db = await getDatabase(config.DATABASE_URL);
  const updated = await db.escalations.accept(req.params.id!, {
    id: req.user!.id,
    name: req.user!.fullName,
  });
  if (!updated) {
    res.status(404).json({ error: "Escalation not found" });
    return;
  }

  // Accepting an escalation should move its ticket too, otherwise the queue and
  // the ticket board disagree about who is working the case.
  if (updated.ticketId) {
    await db.tickets.applyChange(
      updated.ticketId,
      {
        status: "in_progress",
        assigneeId: req.user!.id,
        assigneeName: req.user!.fullName,
      },
      { id: req.user!.id, name: req.user!.fullName },
    );
  }
  res.json({ escalation: updated });
});

escalationRouter.post("/:id/resolve", async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ resolution: z.string().min(1, "Describe the resolution") })
    .safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid resolution" });
    return;
  }

  const db = await getDatabase(config.DATABASE_URL);
  const escalation = await db.escalations.findById(req.params.id!);
  if (!escalation) {
    res.status(404).json({ error: "Escalation not found" });
    return;
  }

  await db.escalations.resolve(escalation.id);
  if (escalation.ticketId) {
    await db.tickets.applyChange(
      escalation.ticketId,
      { status: "resolved", resolution: parsed.data.resolution },
      { id: req.user!.id, name: req.user!.fullName },
    );
  }
  res.json({ ok: true });
});

// ── Team (admin) ──────────────────────────────────────────────────────────────

export const teamRouter = Router();
teamRouter.use(attachUser, requireRole("supervisor"));

teamRouter.get("/", async (_req, res) => {
  const db = await getDatabase(config.DATABASE_URL);
  const users = await db.users.list();
  res.json({ members: users.map(toPublicUser) });
});

teamRouter.patch(
  "/:id",
  requireRole("admin"),
  async (req: AuthedRequest, res) => {
    const parsed = z
      .object({
        role: z.enum(["customer", "agent", "supervisor", "admin"]).optional(),
        isActive: z.boolean().optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid change" });
      return;
    }

    // Guard against an admin locking themselves out of their own install.
    if (
      req.params.id === req.user!.id &&
      (parsed.data.role || parsed.data.isActive === false)
    ) {
      res
        .status(422)
        .json({
          error: "You cannot change your own role or deactivate yourself.",
        });
      return;
    }

    const db = await getDatabase(config.DATABASE_URL);
    const updated = await db.users.update(req.params.id!, parsed.data);
    if (!updated) {
      res.status(404).json({ error: "Team member not found" });
      return;
    }
    res.json({ member: toPublicUser(updated) });
  },
);
