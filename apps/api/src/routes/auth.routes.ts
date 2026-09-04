import { Router } from "express";
import { z } from "zod";
import { getDatabase, toPublicUser } from "@echosphere/db";
import {
  attachUser,
  clearSessionCookie,
  hashPassword,
  passwordProblems,
  requireAuth,
  startSession,
  verifyPassword,
  type AuthedRequest,
} from "../auth.js";
import { config } from "../config.js";

/**
 * Auth and profile routes — requirement 11.
 *
 * Note the shape of the failures: a wrong password and an unknown email return
 * the *same* message, so the endpoint cannot be used to enumerate which emails
 * have accounts.
 */

const router = Router();

const signupSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  fullName: z.string().min(2, "Enter your full name"),
  phone: z.string().trim().min(6).optional().or(z.literal("")),
  role: z.enum(["customer", "agent"]).optional(),
});

router.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid details" });
    return;
  }

  const problems = passwordProblems(parsed.data.password);
  if (problems.length > 0) {
    res.status(400).json({ error: `Password needs ${problems.join(", ")}.` });
    return;
  }

  const db = await getDatabase(config.DATABASE_URL);
  if (await db.users.findByEmail(parsed.data.email)) {
    res
      .status(409)
      .json({ error: "An account with that email already exists." });
    return;
  }

  // Self-serve signup can only ever create the two lowest roles; supervisor and
  // admin are granted by an existing admin from the Team tab.
  const user = await db.users.create({
    email: parsed.data.email,
    passwordHash: await hashPassword(parsed.data.password),
    fullName: parsed.data.fullName,
    phone: parsed.data.phone || null,
    role: parsed.data.role ?? "agent",
  });

  await startSession(res, user, {
    userAgent: req.headers["user-agent"],
    ip: req.ip,
  });
  res.status(201).json({ user: toPublicUser(user) });
});

router.post("/login", async (req, res) => {
  const parsed = z
    .object({ email: z.string().email(), password: z.string().min(1) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your email and password." });
    return;
  }

  const db = await getDatabase(config.DATABASE_URL);
  const user = await db.users.findByEmail(parsed.data.email);

  // Identical response for "no such user" and "wrong password".
  const ok = user
    ? await verifyPassword(parsed.data.password, user.passwordHash)
    : false;
  if (!user || !ok) {
    res.status(401).json({ error: "That email and password do not match." });
    return;
  }
  if (!user.isActive) {
    res.status(403).json({ error: "This account has been deactivated." });
    return;
  }

  await db.users.markLogin(user.id);
  const token = await startSession(res, user, {
    userAgent: req.headers["user-agent"],
    ip: req.ip,
  });

  res.json({ user: toPublicUser(user), token });
});

router.post("/logout", attachUser, async (req: AuthedRequest, res) => {
  if (req.sessionId) {
    const db = await getDatabase(config.DATABASE_URL);
    await db.sessions.revoke(req.sessionId);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", attachUser, (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  res.json({ user: req.user });
});

// ── Profile ───────────────────────────────────────────────────────────────────

const profileSchema = z.object({
  fullName: z.string().min(2).optional(),
  phone: z.string().trim().optional().nullable(),
  locale: z.enum(["en", "hi"]).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  density: z.enum(["comfortable", "compact"]).optional(),
  avatarColor: z.string().max(20).optional(),
  notifyEscalations: z.boolean().optional(),
  notifyDigest: z.boolean().optional(),
});

router.patch(
  "/me",
  attachUser,
  requireAuth,
  async (req: AuthedRequest, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? "Invalid details" });
      return;
    }

    const db = await getDatabase(config.DATABASE_URL);
    const updated = await db.users.update(req.user!.id, parsed.data);
    if (!updated) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    res.json({ user: toPublicUser(updated) });
  },
);

router.post(
  "/me/password",
  attachUser,
  requireAuth,
  async (req: AuthedRequest, res) => {
    const parsed = z
      .object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(1),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter your current and new password." });
      return;
    }

    const db = await getDatabase(config.DATABASE_URL);
    const user = await db.users.findById(req.user!.id);
    if (!user) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    if (
      !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))
    ) {
      res.status(403).json({ error: "Your current password is not correct." });
      return;
    }

    const problems = passwordProblems(parsed.data.newPassword);
    if (problems.length > 0) {
      res
        .status(400)
        .json({ error: `New password needs ${problems.join(", ")}.` });
      return;
    }

    await db.users.update(user.id, {
      passwordHash: await hashPassword(parsed.data.newPassword),
    });

    // Changing a password should end every other session — that is the point of
    // changing it after a suspected compromise.
    const revoked = await db.sessions.revokeAllForUser(user.id, req.sessionId);
    res.json({ ok: true, otherSessionsRevoked: revoked });
  },
);

// ── Sessions ──────────────────────────────────────────────────────────────────

router.get(
  "/me/sessions",
  attachUser,
  requireAuth,
  async (req: AuthedRequest, res) => {
    const db = await getDatabase(config.DATABASE_URL);
    const sessions = await db.sessions.listActive(req.user!.id);
    res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        current: s.id === req.sessionId,
      })),
    });
  },
);

router.delete(
  "/me/sessions/:id",
  attachUser,
  requireAuth,
  async (req: AuthedRequest, res) => {
    const db = await getDatabase(config.DATABASE_URL);
    const sessions = await db.sessions.listActive(req.user!.id);
    const target = sessions.find((s) => s.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    await db.sessions.revoke(target.id);
    if (target.id === req.sessionId) clearSessionCookie(res);
    res.json({ ok: true, wasCurrent: target.id === req.sessionId });
  },
);

export default router;
