import { PLANS, type PlanKey } from "./plans";

type D1Result<T = Record<string, unknown>> = { results?: T[]; success: boolean };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
};
type D1DatabaseLike = { prepare(query: string): D1Statement };

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
  stripe_customer_id: string | null;
};

export async function database() {
  const { env } = await import("cloudflare:workers");
  const binding = (env as unknown as { DB?: D1DatabaseLike }).DB;
  if (!binding) throw new Error("Cloudflare D1 binding DB is not configured.");
  return binding;
}

export async function upsertGoogleUser(profile: { id: string; email: string; name: string; picture: string }) {
  const db = await database();
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO users (id, email, name, picture, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture, updated_at = excluded.updated_at`)
    .bind(profile.id, profile.email, profile.name, profile.picture, now, now).run();
  const existing = await db.prepare("SELECT * FROM workspaces WHERE owner_user_id = ?").bind(profile.id).first<WorkspaceRow>();
  if (!existing) {
    await db.prepare(`INSERT INTO workspaces (id, owner_user_id, name, plan, subscription_status, state_json, created_at, updated_at)
      VALUES (?, ?, ?, 'free', 'free', '{}', ?, ?)`)
      .bind(crypto.randomUUID(), profile.id, profile.name ? `${profile.name}'s workspace` : "My workspace", now, now).run();
  }
  return getUserWorkspace(profile.id);
}

export async function getUserWorkspace(userId: string) {
  const db = await database();
  const user = await db.prepare("SELECT id, email, name, picture, stripe_customer_id FROM users WHERE id = ?").bind(userId).first<UserRow>();
  const workspace = await db.prepare("SELECT * FROM workspaces WHERE owner_user_id = ?").bind(userId).first<WorkspaceRow>();
  return user && workspace ? { user, workspace } : null;
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

export function registerUsage(state: Record<string, unknown>) {
  if (!Array.isArray(state.register)) return 0;
  return new Set(state.register.map((item) => item && typeof item === "object" ? String((item as { abn?: unknown }).abn ?? "") : "").filter(Boolean)).size;
}
