import { PLANS, type PlanKey } from "./plans.ts";

type D1Result<T = Record<string, unknown>> = { results?: T[]; success: boolean };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
};
type D1DatabaseLike = { prepare(query: string): D1Statement; batch(statements: D1Statement[]): Promise<D1Result[]> };
let operationalSchemaPromise: Promise<void> | null = null;

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
  const { env } = await import("cloudflare:workers");
  const binding = (env as unknown as { DB?: D1DatabaseLike }).DB;
  if (!binding) throw new Error("Cloudflare D1 binding DB is not configured.");
  if (!operationalSchemaPromise) operationalSchemaPromise = ensureOperationalSchema(binding);
  try {
    await operationalSchemaPromise;
  } catch (error) {
    operationalSchemaPromise = null;
    throw error;
  }
  return binding;
}

async function ensureOperationalSchema(db: D1DatabaseLike) {
  const columns = await db.prepare("PRAGMA table_info(users)").all<{ name: string }>();
  const statements = [
    db.prepare(`CREATE TABLE IF NOT EXISTS account_actions (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action text NOT NULL,
      code_hash text NOT NULL,
      expires_at integer NOT NULL,
      attempts integer DEFAULT 0 NOT NULL,
      created_at text NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS account_actions_user_action_unique ON account_actions(user_id, action)"),
    db.prepare("CREATE INDEX IF NOT EXISTS account_actions_expiry_index ON account_actions(expires_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS monitoring_events (
      id text PRIMARY KEY NOT NULL,
      category text NOT NULL,
      severity text DEFAULT 'warning' NOT NULL,
      route text DEFAULT '' NOT NULL,
      message text NOT NULL,
      actor_hash text DEFAULT '' NOT NULL,
      metadata_json text DEFAULT '{}' NOT NULL,
      notified_at text,
      created_at text NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS monitoring_events_category_created_index ON monitoring_events(category, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS monitoring_events_severity_created_index ON monitoring_events(severity, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS workspace_data (
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      namespace text NOT NULL,
      item_id text NOT NULL,
      data_json text NOT NULL,
      updated_at text NOT NULL,
      PRIMARY KEY (workspace_id, namespace, item_id)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS workspace_data_workspace_namespace_index ON workspace_data(workspace_id, namespace)"),
  ];
  if (!(columns.results ?? []).some((column) => column.name === "session_version")) {
    statements.push(db.prepare("ALTER TABLE users ADD COLUMN session_version integer DEFAULT 0 NOT NULL"));
  }
  if (!(columns.results ?? []).some((column) => column.name === "clerk_user_id")) {
    statements.push(db.prepare("ALTER TABLE users ADD COLUMN clerk_user_id text"));
  }
  statements.push(db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS users_clerk_user_unique ON users(clerk_user_id)"));
  statements.push(db.prepare("INSERT OR IGNORE INTO d1_migrations(name) VALUES ('0003_gorgeous_black_bolt.sql')"));
  statements.push(db.prepare("INSERT OR IGNORE INTO d1_migrations(name) VALUES ('0004_colorful_wong.sql')"));
  statements.push(db.prepare("INSERT OR IGNORE INTO d1_migrations(name) VALUES ('0005_bitter_grandmaster.sql')"));
  await db.batch(statements);
}

export async function consumeRateLimit(scope: string, key: string, limit: number, windowSeconds: number) {
  const db = await database();
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const result = await db.prepare(`INSERT INTO rate_limits (scope, actor_key, window_start, count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(scope, actor_key, window_start) DO UPDATE SET count = count + 1
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

async function runWorkspaceBatches(db: D1DatabaseLike, statements: D1Statement[]) {
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
  const statements: D1Statement[] = [];

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
