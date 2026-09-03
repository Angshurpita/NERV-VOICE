/**
 * Schema.
 *
 * Kept as a TypeScript string rather than a loose `.sql` file so the migration
 * script works unchanged inside a bundled serverless function, where reading
 * from disk is not dependable.
 *
 * `orders` / `customers` are mirrored here for reporting and joins, but reads
 * during a call are served from the in-process catalogue — a voice turn cannot
 * afford a network round trip per lookup.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id                 TEXT PRIMARY KEY,
  email              TEXT UNIQUE NOT NULL,
  password_hash      TEXT NOT NULL,
  full_name          TEXT NOT NULL,
  phone              TEXT,
  role               TEXT NOT NULL DEFAULT 'agent',
  avatar_color       TEXT NOT NULL DEFAULT 'indigo',
  locale             TEXT NOT NULL DEFAULT 'en',
  theme              TEXT NOT NULL DEFAULT 'light',
  density            TEXT NOT NULL DEFAULT 'comfortable',
  notify_escalations BOOLEAN NOT NULL DEFAULT TRUE,
  notify_digest      BOOLEAN NOT NULL DEFAULT FALSE,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,
  user_agent   TEXT,
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS customers (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  email              TEXT,
  phone              TEXT,
  phone_last4        TEXT,
  city               TEXT,
  preferred_language TEXT NOT NULL DEFAULT 'en'
);

CREATE TABLE IF NOT EXISTS orders (
  id                       TEXT PRIMARY KEY,
  customer_id              TEXT REFERENCES customers(id),
  status                   TEXT NOT NULL,
  items                    JSONB NOT NULL DEFAULT '[]',
  total_inr                INTEGER NOT NULL DEFAULT 0,
  payment_method           TEXT NOT NULL,
  placed_at                DATE,
  expected_delivery_at     DATE,
  delivered_at             DATE,
  cancelled_at             DATE,
  refunded_at              DATE,
  courier                  TEXT,
  tracking_id              TEXT,
  delivery_address         TEXT,
  city                     TEXT,
  return_window_days       INTEGER NOT NULL DEFAULT 10,
  failed_delivery_attempts INTEGER NOT NULL DEFAULT 0,
  history                  JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders(customer_id);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);

CREATE TABLE IF NOT EXISTS calls (
  id                 TEXT PRIMARY KEY,
  case_ref           TEXT UNIQUE NOT NULL,
  customer_id        TEXT,
  caller_name        TEXT,
  caller_phone       TEXT,
  channel_name       TEXT,
  language           TEXT NOT NULL DEFAULT 'en',
  code_switched      BOOLEAN NOT NULL DEFAULT FALSE,
  status             TEXT NOT NULL DEFAULT 'active',
  intent             TEXT,
  order_id           TEXT,
  confidence_overall REAL NOT NULL DEFAULT 0,
  escalated          BOOLEAN NOT NULL DEFAULT FALSE,
  escalation_reason  TEXT,
  resolved_by        TEXT,
  human_request_count INTEGER NOT NULL DEFAULT 0,
  turn_count         INTEGER NOT NULL DEFAULT 0,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at           TIMESTAMPTZ,
  duration_seconds   INTEGER,
  state              JSONB
);
CREATE INDEX IF NOT EXISTS calls_status_idx ON calls(status);
CREATE INDEX IF NOT EXISTS calls_started_idx ON calls(started_at DESC);

CREATE TABLE IF NOT EXISTS transcripts (
  id         TEXT PRIMARY KEY,
  call_id    TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  speaker    TEXT NOT NULL,
  text       TEXT NOT NULL,
  language   TEXT NOT NULL DEFAULT 'en',
  confidence REAL NOT NULL DEFAULT 1,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transcripts_call_idx ON transcripts(call_id, seq);

CREATE TABLE IF NOT EXISTS tickets (
  id            TEXT PRIMARY KEY,
  case_ref      TEXT UNIQUE NOT NULL,
  call_id       TEXT,
  customer_id   TEXT,
  customer_name TEXT NOT NULL,
  order_id      TEXT,
  subject       TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'general',
  status        TEXT NOT NULL DEFAULT 'open',
  priority      TEXT NOT NULL DEFAULT 'medium',
  assignee_id   TEXT,
  assignee_name TEXT,
  sla_due_at    TIMESTAMPTZ,
  resolution    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  closed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets(status);
CREATE INDEX IF NOT EXISTS tickets_updated_idx ON tickets(updated_at DESC);

CREATE TABLE IF NOT EXISTS ticket_events (
  id         TEXT PRIMARY KEY,
  ticket_id  TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_id   TEXT,
  actor_name TEXT NOT NULL,
  kind       TEXT NOT NULL,
  from_value TEXT,
  to_value   TEXT,
  body       TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_events_ticket_idx ON ticket_events(ticket_id, at);

CREATE TABLE IF NOT EXISTS escalations (
  id                 TEXT PRIMARY KEY,
  case_ref           TEXT UNIQUE NOT NULL,
  call_id            TEXT NOT NULL,
  ticket_id          TEXT,
  customer_name      TEXT NOT NULL,
  order_id           TEXT,
  reason             TEXT NOT NULL,
  detail             TEXT NOT NULL DEFAULT '',
  report             JSONB,
  ai_summary         TEXT NOT NULL DEFAULT '',
  language           TEXT NOT NULL DEFAULT 'en',
  status             TEXT NOT NULL DEFAULT 'pending',
  priority           TEXT NOT NULL DEFAULT 'medium',
  assignee_id        TEXT,
  assignee_name      TEXT,
  confidence_overall REAL NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at        TIMESTAMPTZ,
  resolved_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS escalations_status_idx ON escalations(status);
`;
