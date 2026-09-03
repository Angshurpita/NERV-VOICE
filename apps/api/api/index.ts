import { bootstrap, createApp } from '../src/app.js';

/**
 * Vercel serverless entry.
 *
 * `vercel.json` rewrites every path here, so the one function serves the whole
 * API. Express apps are valid Node request handlers, which is why this works
 * without an adapter.
 */

const app = createApp();

// Kick off startup without blocking module evaluation; `bootstrap` is idempotent
// and each handler awaits it before serving.
const ready = bootstrap();

export default async function handler(req: unknown, res: unknown) {
  await ready;
  return (app as unknown as (a: unknown, b: unknown) => void)(req, res);
}
