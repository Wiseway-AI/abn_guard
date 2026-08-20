import { database } from "../../../server/database.ts";
import { hashVerificationCode, sameOriginRequest, verificationCodeMatches } from "../../../server/email-auth.ts";
import { loginRateLimit, recordMonitoringEvent, recordRouteError } from "../../../server/monitoring.ts";
import { clearSessionCookie, sessionFromRequest } from "../../../server/session.ts";
import { stripeDelete } from "../../../server/stripe.ts";

type AccountAction = { code_hash: string; expires_at: number; attempts: number };

export async function DELETE(request: Request) {
  if (!sameOriginRequest(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });
  const rateLimit = await loginRateLimit(request, "account_deletion_confirm", session.user.id, 8, 15 * 60);
  if (!rateLimit.allowed) return Response.json({ error: "Too many deletion attempts. Try again later." }, { status: 429 });

  try {
    const body = await request.json() as { code?: unknown };
    const code = typeof body.code === "string" ? body.code.replace(/\D/g, "").slice(0, 6) : "";
    if (code.length !== 6) return Response.json({ error: "Enter the 6-digit deletion code." }, { status: 400 });
    const db = await database();
    const pending = await db.prepare("SELECT code_hash, expires_at, attempts FROM account_actions WHERE user_id = ? AND action = 'delete_account'")
      .bind(session.user.id).first<AccountAction>();
    if (!pending || pending.expires_at < Date.now()) {
      if (pending) await db.prepare("DELETE FROM account_actions WHERE user_id = ? AND action = 'delete_account'").bind(session.user.id).run();
      return Response.json({ error: "This deletion code has expired. Request a new one." }, { status: 410 });
    }
    if (pending.attempts >= 5) return Response.json({ error: "Too many incorrect attempts. Request a new deletion code." }, { status: 429 });
    const actualHash = await hashVerificationCode(session.user.email, code);
    if (!verificationCodeMatches(pending.code_hash, actualHash)) {
      await db.prepare("UPDATE account_actions SET attempts = attempts + 1 WHERE user_id = ? AND action = 'delete_account'").bind(session.user.id).run();
      return Response.json({ error: "That deletion code is incorrect." }, { status: 400 });
    }

    if (session.workspace.stripe_subscription_id && ["active", "trialing", "past_due", "unpaid", "paused"].includes(session.workspace.subscription_status)) {
      await stripeDelete(`subscriptions/${encodeURIComponent(session.workspace.stripe_subscription_id)}`);
    }

    if (session.user.clerk_user_id) {
      const { clerkClient } = await import("@clerk/nextjs/server");
      const client = await clerkClient();
      await client.users.deleteUser(session.user.clerk_user_id);
    }

    const now = new Date().toISOString();
    await db.batch([
      db.prepare("DELETE FROM feedback WHERE actor_id = ? OR workspace_id = ?").bind(session.user.id, session.workspace.id),
      db.prepare("DELETE FROM contact_requests WHERE email = ?").bind(session.user.email),
      db.prepare("DELETE FROM email_registrations WHERE email = ?").bind(session.user.email),
      db.prepare("DELETE FROM account_actions WHERE user_id = ?").bind(session.user.id),
      db.prepare("DELETE FROM workspaces WHERE id = ? AND owner_user_id = ?").bind(session.workspace.id, session.user.id),
      db.prepare("DELETE FROM users WHERE id = ?").bind(session.user.id),
    ]);
    await recordMonitoringEvent({
      category: "account_deleted",
      severity: "info",
      route: new URL(request.url).pathname,
      message: "A user permanently deleted their ABN Guard account and workspace.",
      actorHash: rateLimit.actorHash,
      metadata: { completedAt: now, subscriptionCancelled: Boolean(session.workspace.stripe_subscription_id) },
    });
    return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie(request) } });
  } catch (error) {
    await recordRouteError(request, "account_deletion_error", error);
    return Response.json({ error: "Your account could not be deleted. No local data was removed. Please try again or contact support." }, { status: 500 });
  }
}
