/**
 * Storage abstraction.
 *
 * Two backends behind one interface:
 *
 *   - **Postgres (Neon)** when `DATABASE_URL` is set. Uses the HTTP driver, so
 *     there is no connection pool to manage in a serverless function.
 *   - **In-memory** otherwise, so the whole system runs locally — and in CI —
 *     with no database to provision. This is a development convenience, not a
 *     production mode: a serverless function gets a fresh process regularly, so
 *     memory-backed data does not survive. The API logs a warning at boot.
 *
 * Repositories are written once, against this interface. That is why the surface
 * is table-oriented rather than SQL-string-oriented: an escape hatch (`raw`)
 * exists for analytics aggregates, and callers must handle it being unavailable.
 */

export type Primitive = string | number | boolean | null;

export type Comparator = "=" | "!=" | "<" | "<=" | ">" | ">=" | "like" | "in";

export interface Condition {
  column: string;
  op: Comparator;
  value: Primitive | Primitive[];
}

/** Shorthand `{ status: 'open' }` or explicit `[{ column, op, value }]`. */
export type Where = Record<string, Primitive> | Condition[];

export interface FindOptions {
  orderBy?: { column: string; direction: "asc" | "desc" };
  limit?: number;
  offset?: number;
}

export interface Store {
  readonly kind: "postgres" | "memory";
  insert<T extends object>(table: string, row: T): Promise<T>;
  update<T extends object>(
    table: string,
    id: string,
    patch: Partial<T>,
  ): Promise<T | null>;
  findById<T>(table: string, id: string): Promise<T | null>;
  findMany<T>(
    table: string,
    where?: Where,
    options?: FindOptions,
  ): Promise<T[]>;
  count(table: string, where?: Where): Promise<number>;
  delete(table: string, id: string): Promise<boolean>;
  /** Postgres only. Memory backend throws — callers must fall back. */
  raw<T>(sql: string, params?: Primitive[]): Promise<T[]>;
  supportsRaw(): boolean;
}

// ── Naming ────────────────────────────────────────────────────────────────────

export function toSnake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function toCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

function keysToSnake(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [toSnake(k), v]),
  );
}

function keysToCamel<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [toCamel(k), v]),
  ) as T;
}

function normaliseWhere(where: Where | undefined): Condition[] {
  if (!where) return [];
  if (Array.isArray(where)) return where;
  return Object.entries(where).map(([column, value]) => ({
    column,
    op: "=" as Comparator,
    value,
  }));
}

// ── Postgres ──────────────────────────────────────────────────────────────────

type SqlExecutor = (
  sql: string,
  params: Primitive[],
) => Promise<Record<string, unknown>[]>;

export class PostgresStore implements Store {
  readonly kind = "postgres" as const;

  constructor(private readonly exec: SqlExecutor) {}

  supportsRaw(): boolean {
    return true;
  }

  async insert<T extends object>(table: string, row: T): Promise<T> {
    const data = keysToSnake(row as Record<string, unknown>);
    const columns = Object.keys(data);
    const placeholders = columns.map((_, i) => `$${i + 1}`);
    const values = columns.map((c) => serialise(data[c]));

    const rows = await this.exec(
      `INSERT INTO ${ident(table)} (${columns.map(ident).join(", ")})
       VALUES (${placeholders.join(", ")}) RETURNING *`,
      values,
    );
    return keysToCamel<T>(rows[0] ?? data);
  }

  async update<T extends object>(
    table: string,
    id: string,
    patch: Partial<T>,
  ): Promise<T | null> {
    const data = keysToSnake(patch as Record<string, unknown>);
    const columns = Object.keys(data);
    if (columns.length === 0) return this.findById<T>(table, id);

    const assignments = columns.map((c, i) => `${ident(c)} = $${i + 1}`);
    const values = columns.map((c) => serialise(data[c]));

    const rows = await this.exec(
      `UPDATE ${ident(table)} SET ${assignments.join(", ")}
       WHERE id = $${columns.length + 1} RETURNING *`,
      [...values, id],
    );
    return rows[0] ? keysToCamel<T>(rows[0]) : null;
  }

  async findById<T>(table: string, id: string): Promise<T | null> {
    const rows = await this.exec(
      `SELECT * FROM ${ident(table)} WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ? keysToCamel<T>(rows[0]) : null;
  }

  async findMany<T>(
    table: string,
    where?: Where,
    options?: FindOptions,
  ): Promise<T[]> {
    const conditions = normaliseWhere(where);
    const { clause, params } = buildWhereClause(conditions);

    let sql = `SELECT * FROM ${ident(table)}${clause}`;
    if (options?.orderBy) {
      sql += ` ORDER BY ${ident(toSnake(options.orderBy.column))} ${
        options.orderBy.direction === "desc" ? "DESC" : "ASC"
      }`;
    }
    if (options?.limit !== undefined) sql += ` LIMIT ${Number(options.limit)}`;
    if (options?.offset !== undefined)
      sql += ` OFFSET ${Number(options.offset)}`;

    const rows = await this.exec(sql, params);
    return rows.map((r) => keysToCamel<T>(r));
  }

  async count(table: string, where?: Where): Promise<number> {
    const { clause, params } = buildWhereClause(normaliseWhere(where));
    const rows = await this.exec(
      `SELECT COUNT(*)::int AS n FROM ${ident(table)}${clause}`,
      params,
    );
    return Number((rows[0] as { n?: number } | undefined)?.n ?? 0);
  }

  async delete(table: string, id: string): Promise<boolean> {
    const rows = await this.exec(
      `DELETE FROM ${ident(table)} WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows.length > 0;
  }

  async raw<T>(sql: string, params: Primitive[] = []): Promise<T[]> {
    const rows = await this.exec(sql, params);
    return rows.map((r) => keysToCamel<T>(r));
  }
}

function buildWhereClause(conditions: Condition[]): {
  clause: string;
  params: Primitive[];
} {
  if (conditions.length === 0) return { clause: "", params: [] };

  const params: Primitive[] = [];
  const parts = conditions.map((c) => {
    const column = ident(toSnake(c.column));
    if (c.op === "in") {
      const list = Array.isArray(c.value) ? c.value : [c.value];
      if (list.length === 0) return "FALSE";
      const placeholders = list.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `${column} IN (${placeholders.join(", ")})`;
    }
    if (c.value === null)
      return c.op === "!=" ? `${column} IS NOT NULL` : `${column} IS NULL`;
    params.push(c.value as Primitive);
    const op = c.op === "like" ? "ILIKE" : c.op;
    return `${column} ${op} $${params.length}`;
  });

  return { clause: ` WHERE ${parts.join(" AND ")}`, params };
}

/**
 * Quote an identifier.
 *
 * Table and column names here are all internal constants, never user input —
 * but quoting them costs nothing and means a future column called `order` or
 * `user` cannot silently become a syntax error.
 */
function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

function serialise(value: unknown): Primitive {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "object") return JSON.stringify(value);
  if (value instanceof Date) return (value as Date).toISOString();
  return value as Primitive;
}

import fs from "node:fs";
import path from "node:path";

// ── Memory ────────────────────────────────────────────────────────────────────

function getDevStorePath(): string {
  if (process.env.DEV_STORE_PATH) {
    return path.resolve(process.env.DEV_STORE_PATH);
  }
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, ".data", "dev-store.json"),
    path.resolve(cwd, "apps", "api", ".data", "dev-store.json"),
    path.resolve(cwd, "..", ".data", "dev-store.json"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private tables = new Map<string, Map<string, Record<string, unknown>>>();
  private readonly storePath: string;

  constructor(filePath?: string) {
    this.storePath = filePath ?? getDevStorePath();
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, "utf-8");
        const data = JSON.parse(raw);
        if (data && typeof data === "object") {
          for (const [tableName, rows] of Object.entries(data)) {
            const tableMap = new Map<string, Record<string, unknown>>();
            if (rows && typeof rows === "object") {
              for (const [id, row] of Object.entries(
                rows as Record<string, Record<string, unknown>>,
              )) {
                tableMap.set(id, row);
              }
            }
            this.tables.set(tableName, tableMap);
          }
        }
      }
    } catch {
      // Ignore initial load failure
    }
  }

  private saveToDisk(): void {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: Record<string, Record<string, unknown>> = {};
      for (const [table, map] of this.tables.entries()) {
        data[table] = Object.fromEntries(map.entries());
      }
      fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2), "utf-8");
    } catch {
      // Ignore disk write errors in ephemeral environments
    }
  }

  supportsRaw(): boolean {
    return false;
  }

  private table(name: string): Map<string, Record<string, unknown>> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  async insert<T extends object>(table: string, row: T): Promise<T> {
    const id = String((row as { id?: unknown }).id ?? cryptoRandomId());
    const stored = { ...row, id };
    this.table(table).set(id, stored);
    this.saveToDisk();
    return structuredClone(stored) as T;
  }

  async update<T extends object>(
    table: string,
    id: string,
    patch: Partial<T>,
  ): Promise<T | null> {
    const t = this.table(table);
    const existing = t.get(id);
    if (!existing) return null;
    const merged = {
      ...existing,
      ...stripUndefined(patch as Record<string, unknown>),
    };
    t.set(id, merged);
    this.saveToDisk();
    return structuredClone(merged) as T;
  }

  async findById<T>(table: string, id: string): Promise<T | null> {
    const row = this.table(table).get(id);
    return row ? (structuredClone(row) as T) : null;
  }

  async findMany<T>(
    table: string,
    where?: Where,
    options?: FindOptions,
  ): Promise<T[]> {
    const conditions = normaliseWhere(where);
    let rows = [...this.table(table).values()].filter((row) =>
      conditions.every((c) => matches(row, c)),
    );

    if (options?.orderBy) {
      const { column, direction } = options.orderBy;
      rows = rows.sort(
        (a, b) =>
          compare(a[column], b[column]) * (direction === "desc" ? -1 : 1),
      );
    }

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? rows.length;
    return rows
      .slice(offset, offset + limit)
      .map((r) => structuredClone(r) as T);
  }

  async count(table: string, where?: Where): Promise<number> {
    const conditions = normaliseWhere(where);
    return [...this.table(table).values()].filter((row) =>
      conditions.every((c) => matches(row, c)),
    ).length;
  }

  async delete(table: string, id: string): Promise<boolean> {
    const deleted = this.table(table).delete(id);
    if (deleted) this.saveToDisk();
    return deleted;
  }

  async raw<T>(): Promise<T[]> {
    throw new Error(
      "raw SQL is not available on the in-memory store; compute the aggregate in TypeScript instead",
    );
  }

  /** Test helper — drops everything. */
  reset(): void {
    this.tables.clear();
  }
}

function matches(row: Record<string, unknown>, condition: Condition): boolean {
  const actual = row[condition.column];
  const { op, value } = condition;

  switch (op) {
    case "=":
      return actual === value || (value === null && actual == null);
    case "!=":
      return actual !== value;
    case "in":
      return (Array.isArray(value) ? value : [value]).includes(
        actual as Primitive,
      );
    case "like": {
      if (typeof actual !== "string" || typeof value !== "string") return false;
      return actual
        .toLowerCase()
        .includes(value.replace(/%/g, "").toLowerCase());
    }
    case "<":
      return compare(actual, value) < 0;
    case "<=":
      return compare(actual, value) <= 0;
    case ">":
      return compare(actual, value) > 0;
    case ">=":
      return compare(actual, value) >= 0;
  }
}

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  );
}

export function cryptoRandomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `id_${Math.random().toString(36).slice(2, 12)}`
  );
}

// ── Factory ───────────────────────────────────────────────────────────────────

let cached: Store | null = null;

/**
 * Resolve the store for this process.
 *
 * Cached because in a warm serverless function the module is reused across
 * invocations, and re-creating the Neon client per request wastes the keep-alive.
 */
export async function getStore(databaseUrl?: string): Promise<Store> {
  if (cached) return cached;

  const url = databaseUrl?.trim();
  const usable =
    url && /^postgres(ql)?:\/\//.test(url) && !url.includes("localhost:5432");

  if (usable) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url!);
    cached = new PostgresStore(async (text, params) => {
      const result = (await sql.query(text, params)) as unknown;
      return (Array.isArray(result) ? result : []) as Record<string, unknown>[];
    });
  } else {
    cached = new MemoryStore();
  }

  return cached;
}

/** Test/CLI helper — forces a specific store. */
export function setStore(store: Store): void {
  cached = store;
}
