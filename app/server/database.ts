import { PLANS, type PlanKey } from "./plans";

type D1Result<T = Record<string, unknown>> = { results?: T[]; success: boolean };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
};
type D1DatabaseLike = { prepare(query: string): D1Statement; batch(statements: D1Statement[]): Promise<D1Result[]> };

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
  auth_provider: "google" | "email";
  password_hash: string | null;
  email_verified_at: string | null;
  stripe_customer_id: string | null;
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
  return binding;
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
  const user = await db.prepare("SELECT id, email, name, picture, auth_provider, password_hash, email_verified_at, stripe_customer_id FROM users WHERE id = ?").bind(userId).first<UserRow>();
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
