import cookieParser from "cookie-parser";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { catalogueStats, ensureSeedData, getDatabase } from "@echosphere/db";
import { config, describeConfig } from "./config.js";
import { ensureSeedAdmin } from "./auth.js";
import authRoutes from "./routes/auth.routes.js";
import callsRoutes from "./routes/calls.routes.js";
import ticketsRoutes, {
  escalationRouter,
  teamRouter,
} from "./routes/tickets.routes.js";
import {
  agoraRouter,
  analyticsRouter,
  catalogueRouter,
} from "./routes/misc.routes.js";

/**
 * The API, as one Express app.
 *
 * Exported rather than started here so the same app object serves both
 * `src/server.ts` (local, listens on a port) and `api/index.ts` (Vercel, invoked
 * as a serverless function).
 */

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);

  /**
   * CORS with credentials, because the dashboard and the caller simulator are
   * separate deployments on separate origins and both send the session cookie.
   * `credentials: true` forbids a wildcard origin, so the allowlist is explicit.
   */
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true); // curl, server-to-server
        if (config.CORS_ORIGINS.includes(origin)) return callback(null, true);
        // Any *.vercel.app preview of these projects is allowed, so preview
        // deployments work without re-listing every generated URL.
        if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin))
          return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed`));
      },
      credentials: true,
    }),
  );

  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());

  app.get("/health", async (_req, res) => {
    res.json({
      status: "ok",
      environment: config.NODE_ENV,
      persistence: config.DATABASE_URL ? "postgres" : "memory",
      model: config.gemini.enabled ? config.gemini.model : null,
      agora: config.agora.enabled,
      catalogue: catalogueStats(),
      escalateAfterHumanRequests: 3,
    });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/calls", callsRoutes);
  app.use("/api/tickets", ticketsRoutes);
  app.use("/api/escalations", escalationRouter);
  app.use("/api/team", teamRouter);
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/catalogue", catalogueRouter);
  app.use("/api/agora", agoraRouter);

  app.use((req, res) => {
    res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
  });

  // Four arguments, so Express recognises this as the error handler.
  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    const isCors = error.message.includes("is not allowed");
    if (!isCors) console.error("[api]", error);
    res.status(isCors ? 403 : 500).json({
      error: isCors ? error.message : "Something went wrong on our end.",
    });
  });

  return app;
}

/**
 * One-time startup work.
 *
 * Idempotent, because on Vercel this runs per cold start rather than once per
 * deploy.
 */
let bootstrapped: Promise<void> | null = null;

export function bootstrap(): Promise<void> {
  bootstrapped ??= (async () => {
    for (const line of describeConfig()) console.log(`[config] ${line}`);

    const seeded = await ensureSeedAdmin();
    if (seeded) {
      console.log(
        `\n[auth] Created the first admin account:\n` +
          `        email    ${seeded.email}\n` +
          `        password ${seeded.password}\n` +
          `        Change this from Settings → Security after signing in.\n`,
      );
    }

    const db = await getDatabase(config.DATABASE_URL);
    await ensureSeedData(db);

    if (!config.DATABASE_URL) {
      console.warn(
        "[db] No DATABASE_URL — running in memory. Calls and tickets will vanish on restart.\n" +
          "     Set DATABASE_URL to a Neon connection string to persist them.",
      );
    }
  })();
  return bootstrapped;
}
