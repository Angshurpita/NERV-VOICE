import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { getDatabase, toPublicUser, type PublicUser, type UserRole } from '@echosphere/db';
import { config } from './config.js';

/**
 * Authentication — requirement 11.
 *
 * What this replaces: a login route that auto-created any unknown email and
 * never checked the password, plus a client that gated on
 * `localStorage.isAuthenticated`. So: real bcrypt hashes, a signed httpOnly
 * cookie, and a `sessions` row per login so a session can actually be revoked.
 */

const COOKIE_NAME = 'echosphere_session';
const ROLE_RANK: Record<UserRole, number> = { customer: 0, agent: 1, supervisor: 2, admin: 3 };

export interface AuthedRequest extends Request {
  user?: PublicUser;
  sessionId?: string;
}

// ── Passwords ─────────────────────────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 11);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/** Minimum viable password policy, enforced server-side. */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 8) problems.push('at least 8 characters');
  if (!/[a-z]/.test(password)) problems.push('a lowercase letter');
  if (!/[A-Z0-9]/.test(password)) problems.push('an uppercase letter or a digit');
  return problems;
}

// ── Tokens ────────────────────────────────────────────────────────────────────

interface TokenPayload {
  sub: string;
  sid: string;
  role: UserRole;
}

function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.AUTH_SECRET, {
    expiresIn: `${config.SESSION_TTL_DAYS}d`,
    issuer: 'echosphere',
  });
}

function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, config.AUTH_SECRET, { issuer: 'echosphere' }) as TokenPayload;
  } catch {
    return null;
  }
}

/**
 * Sessions are stored as a hash of the token, not the token itself — so a leaked
 * database cannot be replayed as a set of valid cookies.
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ── Cookie ────────────────────────────────────────────────────────────────────

/**
 * `SameSite=None` in production because the caller simulator is deployed to its
 * own domain and must be able to authenticate against this API. That requires
 * `Secure`, which is why development (http://localhost) uses `Lax` instead.
 */
function cookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'none' | 'lax';
  maxAge: number;
  path: string;
} {
  return {
    httpOnly: true,
    secure: config.IS_PRODUCTION,
    sameSite: config.IS_PRODUCTION ? 'none' : 'lax',
    maxAge: config.SESSION_TTL_DAYS * 86_400_000,
    path: '/',
  };
}

export async function startSession(
  res: Response,
  user: { id: string; role: UserRole },
  meta: { userAgent?: string; ip?: string },
): Promise<string> {
  const db = await getDatabase(config.DATABASE_URL);

  // The session id is minted first so it can be embedded in the token, which
  // makes "revoke this one device" possible without a token blacklist.
  const sessionId = crypto.randomUUID();
  const token = signToken({ sub: user.id, sid: sessionId, role: user.role });

  await db.sessions.create({
    id: sessionId,
    userId: user.id,
    tokenHash: hashToken(token),
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
    ttlDays: config.SESSION_TTL_DAYS,
  });

  res.cookie(COOKIE_NAME, token, cookieOptions());
  return token;
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined as unknown as number });
}

function extractToken(req: Request): string | null {
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME];
  if (fromCookie) return fromCookie;

  // Bearer is accepted as a fallback: Safari and some in-app browsers block
  // third-party cookies outright, which would otherwise break the caller app.
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

// ── Middleware ────────────────────────────────────────────────────────────────

/** Attaches `req.user` when a valid session exists. Never rejects. */
export async function attachUser(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractToken(req);
  if (!token) return next();

  const payload = verifyToken(token);
  if (!payload) return next();

  const db = await getDatabase(config.DATABASE_URL);
  const session = await db.sessions.findByTokenHash(hashToken(token));
  if (!session) return next();

  const user = await db.users.findById(payload.sub);
  if (!user || !user.isActive) return next();

  req.user = toPublicUser(user);
  req.sessionId = session.id;
  void db.sessions.touch(session.id);
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Sign in to continue.' });
    return;
  }
  next();
}

/**
 * Role gate.
 *
 * Enforced here rather than by hiding navigation, so a `customer` account cannot
 * reach staff data by typing a URL or calling the API directly.
 */
export function requireRole(minimum: UserRole) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Sign in to continue.' });
      return;
    }
    if (ROLE_RANK[req.user.role] < ROLE_RANK[minimum]) {
      res.status(403).json({ error: 'You do not have access to this.' });
      return;
    }
    next();
  };
}

export { COOKIE_NAME, hashToken, ROLE_RANK };

/**
 * Create the first admin on an empty install.
 *
 * Without this a fresh clone has no way in — signup would be the only route, and
 * self-serve signup granting admin is worse. Logged loudly, and off in
 * production.
 */
export async function ensureSeedAdmin(): Promise<{ email: string; password: string } | null> {
  if (!config.seedAdmin.enabled) return null;

  const db = await getDatabase(config.DATABASE_URL);
  if ((await db.users.count()) > 0) return null;

  const problems = passwordProblems(config.seedAdmin.password);
  if (problems.length > 0) {
    console.warn(`[auth] SEED_ADMIN_PASSWORD is too weak (needs ${problems.join(', ')}); skipping.`);
    return null;
  }

  await db.users.create({
    email: config.seedAdmin.email,
    passwordHash: await hashPassword(config.seedAdmin.password),
    fullName: config.seedAdmin.name,
    role: 'admin',
  });

  return { email: config.seedAdmin.email, password: config.seedAdmin.password };
}
