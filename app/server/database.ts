import { PLANS, type PlanKey } from "./plans.ts";
import postgres from "postgres";
import { databaseUrlFromEnvironment } from "./database-url.ts";

type DatabaseResult<T = Record<string, unknown>> = { results?: T[]; success: boolean };
type QueryExecutor = {
  unsafe(query: string, values?: unknown[]): Promise<unknown[]>;
};
type DatabaseStatement = {
  bind(...values: unknown[]): DatabaseStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
  all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
};
type DatabaseLike = { prepare(query: string): DatabaseStatement; batch(statements: DatabaseStatement[]): Promise<DatabaseResult[]> };

let postgresClient: ReturnType<typeof postgres> | null = null;
let databaseAdapter: DatabaseLike | null = null;

function numberedPlaceholders(query: string) {
  let position = 0;
  return query.replace(/\?/g, () => `$${++position}`);
}

class PostgresStatement implements DatabaseStatement {
  private values: unknown[] = [];

  constructor(private readonly query: string, private readonly executor: () => QueryExecutor) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async execute(executor = this.executor()) {
    return await executor.unsafe(numberedPlaceholders(this.query), this.values) as Record<string, unknown>[];
  }

  async first<T = Record<string, unknown>>() {
    const rows = await this.execute();
    return (rows[0] as T | undefined) ?? null;
  }

  async run<T = Record<string, unknown>>() {
    const rows = await this.execute();
    return { results: rows as T[], success: true };
  }

  async all<T = Record<string, unknown>>() {
    const rows = await this.execute();
    return { results: rows as T[], success: true };
  }
}

const WORKSPACE_COLLECTIONS = ["register", "changes", "history", "today"] as const;
const WORKSPACE_STATE_MARKER = "state";
const WORKSPACE_STATE_VERSION = 1;

export type WorkspaceDataRow = {
  namespace: string;
  item_id: string;
  data_json: string;
};

export type WorkspaceRow = {
  id: string;
  owner_user_id: string;
  name: string;
  plan: PlanKey;
  subscription_status: string;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  current_period_end: number | null;
  state_json: string;
};

export type UserRow = {
  id: string;
  email: string;
  name: string;
  picture: string;
  auth_provider: "google" | "email" | "clerk";
  clerk_user_id: string | null;
  password_hash: string | null;
  email_verified_at: string | null;
  stripe_customer_id: string | null;
  session_version: number;
};

export type EmailRegistrationRow = {
  email: string;
  company_name: string;
  password_hash: string;
  code_hash: string;
  expires_at: number;
  attempts: number;
  last_sent_at: number;
  created_at: string;
};

export async function database() {
  const url = databaseUrlFromEnvironment();
  if (!postgresClient) postgresClient = postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
  });
  if (!databaseAdapter) {
    const client = postgresClient;
    databaseAdapter = {
      prepare(query: string) {
        return new PostgresStatement(query, () => client as unknown as QueryExecutor);
      },
      async batch(statements: DatabaseStatement[]) {
        return await client.begin(async (transaction) => {
          const results: DatabaseResult[] = [];
          for (const statement of statements) {
            const rows = await (statement as PostgresStatement).execute(transaction as unknown as QueryExecutor);
            results.push({ results: rows, success: true });
          }
          return results;
        });
      },
    };
  }
  return databaseAdapter;
}

export async function consumeRateLimit(scope: string, key: string, limit: number, windowSeconds: number) {
  const db = await database();
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const result = await db.prepare(`INSERT INTO rate_limits (scope, actor_key, window_start, count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(scope, actor_key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count`)
    .bind(scope, key, windowStart)
    .first<{ count: number }>();
  return { allowed: Boolean(result && result.count <= limit), remaining: Math.max(0, limit - (result?.count ?? limit)), resetAt: windowStart + windowSeconds };
}

export async function upsertGoogleUser(profile: { id: string; email: string; name: string; picture: string }) {
  const db = await database();
  const now = new Date().toISOString();
  const matchingEmail = await db.prepare("SELECT id, password_hash FROM users WHERE email = ?").bind(profile.email).first<{ id: string; password_hash: string | null }>();
  const userId = matchingEmail?.id || profile.id;
  if (matchingEmail) {
    await db.prepare("UPDATE users SET name = ?, picture = ?, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?")
      .bind(profile.name, profile.picture, now, now, userId).run();
  } else {
    await db.prepare(`INSERT INTO users (id, email, name, picture, auth_provider, email_verified_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'google', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture, email_verified_at = excluded.email_verified_at, updated_at = excluded.updated_at`)
      .bind(userId, profile.email, profile.name, profile.picture, now, now, now).run();
  }
  const existing = await db.prepare("SELECT * FROM workspaces WHERE owner_user_id = ?").bind(userId).first<WorkspaceRow>();
  if (!existing) {
    await db.prepare(`INSERT INTO workspaces (id, owner_user_id, name, plan, subscription_status, state_json, created_at, updated_at)
      VALUES (?, ?, ?, 'free', 'free', '{}', ?, ?)`)
      .bind(crypto.randomUUID(), userId, profile.name ? `${profile.name}'s workspace` : "My workspace", now, now).run();
  }
  return getUserWorkspace(userId);
}

export async function getUserWorkspace(userId: string) {
  const db = await database();
  const user = await db.prepare("SELECT id, email, name, picture, auth_provider, clerk_user_id, password_hash, email_verified_at, stripe_customer_id, session_version FROM users WHERE id = ?").bind(userId).first<UserRow>();
  const workspace = await db.prepare("SELECT * FROM workspaces WHERE owner_user_id = ?").bind(userId).first<WorkspaceRow>();
  return user && workspace ? { user, workspace } : null;
}

export async function getClerkUserWorkspace(clerkUserId: string) {
  const db = await database();
  const user = await db.prepare("SELECT id, email, name, picture, auth_provider, clerk_user_id, password_hash, email_verified_at, stripe_customer_id, session_version FROM users WHERE clerk_user_id = ?")
    .bind(clerkUserId)
    .first<UserRow>();
  if (!user) return null;
  const workspace = await db.prepare("SELECT * FROM workspaces WHERE owner_user_id = ?").bind(user.id).first<WorkspaceRow>();
  return workspace ? { user, workspace } : null;
}

export async function upsertClerkUser(profile: { clerkUserId: string; email: string; name: string; picture: string }) {
  const db = await database();
  const now = new Date().toISOString();
  const existingClerk = await db.prepare("SELECT id FROM users WHERE clerk_user_id = ?").bind(profile.clerkUserId).first<{ id: string }>();
  const existingEmail = existingClerk ? null : await db.prepare("SELECT id FROM users WHERE email = ?").bind(profile.email).first<{ id: string }>();
  const userId = existingClerk?.id || existingEmail?.id || `clerk-${profile.clerkUserId}`;

  if (existingClerk || existingEmail) {
    await db.prepare(`UPDATE users SET email = ?, name = ?, picture = ?, auth_provider = 'clerk', clerk_user_id = ?,
      email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?`)
      .bind(profile.email, profile.name, profile.picture, profile.clerkUserId, now, now, userId)
      .run();
  } else {
    await db.prepare(`INSERT INTO users (id, email, name, picture, auth_provider, clerk_user_id, email_verified_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'clerk', ?, ?, ?, ?)`)
      .bind(userId, profile.email, profile.name, profile.picture, profile.clerkUserId, now, now, now)
      .run();
  }

  const workspace = await db.prepare("SELECT id FROM workspaces WHERE owner_user_id = ?").bind(userId).first<{ id: string }>();
  if (!workspace) {
    await db.prepare(`INSERT INTO workspaces (id, owner_user_id, name, plan, subscription_status, state_json, created_at, updated_at)
      VALUES (?, ?, ?, 'free', 'free', '{}', ?, ?)`)
      .bind(crypto.randomUUID(), userId, profile.name ? `${profile.name}'s workspace` : "My workspace", now, now)
      .run();
  }
  return getUserWorkspace(userId);
}

export function publicWorkspace(workspace: WorkspaceRow, usage: number) {
  const plan = workspace.plan in PLANS ? workspace.plan : "free";
  return {
    id: workspace.id,
    name: workspace.name,
    plan,
    planName: PLANS[plan].name,
    subscriptionStatus: workspace.subscription_status,
    currentPeriodEnd: workspace.current_period_end,
    usage,
    abnLimit: PLANS[plan].abnLimit,
  };
}

export function parseWorkspaceState(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function collectionItemId(namespace: typeof WORKSPACE_COLLECTIONS[number], value: Record<string, unknown>, index: number) {
  if (namespace === "register") return String(value.abn ?? `record-${index}`);
  return String(value.id ?? `record-${index}`);
}

export function workspaceStateRows(state: Record<string, unknown>): WorkspaceDataRow[] {
  const rows: WorkspaceDataRow[] = [];
  const account = objectValue(state.account);
  if (account) rows.push({ namespace: "account", item_id: "account", data_json: JSON.stringify(account) });

  for (const namespace of WORKSPACE_COLLECTIONS) {
    const collection = Array.isArray(state[namespace]) ? state[namespace] : [];
    collection.forEach((item, position) => {
      const value = objectValue(item);
      if (!value) return;
      rows.push({
        namespace,
        item_id: collectionItemId(namespace, value, position),
        data_json: JSON.stringify({ position, value }),
      });
    });
  }

  rows.push({
    namespace: "settings",
    item_id: "settings",
    data_json: JSON.stringify({
      schedule: state.schedule === "manual" ? "manual" : "weekly",
      lastRefresh: typeof state.lastRefresh === "string" ? state.lastRefresh : "",
    }),
  });
  return rows;
}

export function workspaceStateFromRows(rows: WorkspaceDataRow[], fallback: Record<string, unknown> = {}) {
  const hasMarker = rows.some((row) => row.namespace === "meta" && row.item_id === WORKSPACE_STATE_MARKER);
  if (!hasMarker) return fallback;

  const state: Record<string, unknown> = { ...fallback };
  const collections = new Map<string, { position: number; value: Record<string, unknown> }[]>();
  for (const namespace of WORKSPACE_COLLECTIONS) collections.set(namespace, []);

  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.data_json) as unknown;
      if (row.namespace === "account" && row.item_id === "account") {
        const account = objectValue(parsed);
        if (account) state.account = account;
        continue;
      }
      if (row.namespace === "settings" && row.item_id === "settings") {
        const settings = objectValue(parsed);
        if (settings) {
          state.schedule = settings.schedule === "manual" ? "manual" : "weekly";
          state.lastRefresh = typeof settings.lastRefresh === "string" ? settings.lastRefresh : "";
        }
        continue;
      }
      if (!collections.has(row.namespace)) continue;
      const envelope = objectValue(parsed);
      const value = objectValue(envelope?.value ?? parsed);
      if (!value) continue;
      const position = typeof envelope?.position === "number" ? envelope.position : Number.MAX_SAFE_INTEGER;
      collections.get(row.namespace)!.push({ position, value });
    } catch {
      // A malformed independent record must not prevent the rest of the workspace loading.
    }
  }

  for (const namespace of WORKSPACE_COLLECTIONS) {
    state[namespace] = collections.get(namespace)!
      .sort((left, right) => left.position - right.position)
      .map((entry) => entry.value);
  }
  return state;
}

export async function loadWorkspaceState(workspace: WorkspaceRow) {
  const fallback = parseWorkspaceState(workspace.state_json);
  const db = await database();
  const result = await db.prepare("SELECT namespace, item_id, data_json FROM workspace_data WHERE workspace_id = ?")
    .bind(workspace.id)
    .all<WorkspaceDataRow>();
  return workspaceStateFromRows(result.results ?? [], fallback);
}

async function runWorkspaceBatches(db: DatabaseLike, statements: DatabaseStatement[]) {
  const batchSize = 75;
  for (let offset = 0; offset < statements.length; offset += batchSize) {
    await db.batch(statements.slice(offset, offset + batchSize));
  }
}

export async function saveWorkspaceState(workspaceId: string, state: Record<string, unknown>, stateJson = JSON.stringify(state)) {
  const db = await database();
  const updatedAt = new Date().toISOString();
  await db.prepare("UPDATE workspaces SET state_json = ?, updated_at = ? WHERE id = ?").bind(stateJson, updatedAt, workspaceId).run();

  // Readers fall back to state_json until the independent records are fully written.
  await db.prepare("DELETE FROM workspace_data WHERE workspace_id = ? AND namespace = 'meta' AND item_id = ?")
    .bind(workspaceId, WORKSPACE_STATE_MARKER)
    .run();

  const existingResult = await db.prepare("SELECT namespace, item_id, data_json FROM workspace_data WHERE workspace_id = ? AND namespace != 'meta'")
    .bind(workspaceId)
    .all<WorkspaceDataRow>();
  const existing = new Map((existingResult.results ?? []).map((row) => [`${row.namespace}\u0000${row.item_id}`, row.data_json]));
  const desiredRows = workspaceStateRows(state);
  const desiredKeys = new Set(desiredRows.map((row) => `${row.namespace}\u0000${row.item_id}`));
  const statements: DatabaseStatement[] = [];

  for (const row of desiredRows) {
    if (existing.get(`${row.namespace}\u0000${row.item_id}`) === row.data_json) continue;
    statements.push(db.prepare(`INSERT INTO workspace_data (workspace_id, namespace, item_id, data_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, namespace, item_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`)
      .bind(workspaceId, row.namespace, row.item_id, row.data_json, updatedAt));
  }
  for (const row of existingResult.results ?? []) {
    if (desiredKeys.has(`${row.namespace}\u0000${row.item_id}`)) continue;
    statements.push(db.prepare("DELETE FROM workspace_data WHERE workspace_id = ? AND namespace = ? AND item_id = ?")
      .bind(workspaceId, row.namespace, row.item_id));
  }
  await runWorkspaceBatches(db, statements);
  await db.prepare(`INSERT INTO workspace_data (workspace_id, namespace, item_id, data_json, updated_at)
    VALUES (?, 'meta', ?, ?, ?)
    ON CONFLICT(workspace_id, namespace, item_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`)
    .bind(workspaceId, WORKSPACE_STATE_MARKER, JSON.stringify({ version: WORKSPACE_STATE_VERSION }), updatedAt)
    .run();
}

export function registerUsage(state: Record<string, unknown>) {
  if (!Array.isArray(state.register)) return 0;
  return new Set(state.register.map((item) => item && typeof item === "object" ? String((item as { abn?: unknown }).abn ?? "") : "").filter(Boolean)).size;
}
