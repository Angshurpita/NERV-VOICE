import {
  AnalyticsRepository,
  CallRepository,
  EscalationRepository,
  OrderRepository,
  SessionRepository,
  TicketRepository,
  TranscriptRepository,
} from './repositories.js';
import { getStore, type Store } from './store.js';
import { UserRepository } from './repositories.js';

export * from './types.js';
export * from './store.js';
export * from './catalogue.js';
export * from './repositories.js';
export * from './seed.js';
export { SCHEMA_SQL } from './schema.js';

/** Every repository, sharing one store. */
export interface Database {
  store: Store;
  users: UserRepository;
  sessions: SessionRepository;
  orders: OrderRepository;
  calls: CallRepository;
  transcripts: TranscriptRepository;
  tickets: TicketRepository;
  escalations: EscalationRepository;
  analytics: AnalyticsRepository;
}

let cached: Database | null = null;

/**
 * Build (or reuse) the database.
 *
 * Cached at module scope so a warm serverless invocation reuses the Neon client
 * and — critically for local development — the in-memory data survives between
 * requests within the same process.
 */
export async function getDatabase(databaseUrl?: string): Promise<Database> {
  if (cached) return cached;

  const store = await getStore(databaseUrl);
  const calls = new CallRepository(store);
  const tickets = new TicketRepository(store);
  const escalations = new EscalationRepository(store);

  cached = {
    store,
    users: new UserRepository(store),
    sessions: new SessionRepository(store),
    orders: new OrderRepository(store),
    calls,
    transcripts: new TranscriptRepository(store),
    tickets,
    escalations,
    analytics: new AnalyticsRepository(calls, tickets, escalations),
  };

  return cached;
}

export function resetDatabase(): void {
  cached = null;
}
