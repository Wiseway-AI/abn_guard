import { database } from "../../../../server/database.ts";
import { hashVerificationCode, sameOriginRequest, sendAccountDeletionEmail, verificationCode } from "../../../../server/email-auth.ts";
import { loginRateLimit, recordMonitoringEvent, recordRouteError } from "../../../../server/monitoring.ts";
import { sessionFromRequest } from "../../../../server/session.ts";

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });
  const rateLimit = await loginRateLimit(request, "account_deletion_request", session.user.id, 3, 60 * 60);
  if (!rateLimit.allowed) return Response.json({ error: "Too many deletion codes were requested. Try again later." }, { status: 429 });

  try {
    const code = verificationCode();
    const codeHash = await hashVerificationCode(session.user.email, code);
    const db = await database();
    const now = Date.now();
    await db.prepare(`INSERT INTO account_actions (id, user_id, action, code_hash, expires_at, attempts, created_at)
      VALUES (?, ?, 'delete_account', ?, ?, 0, ?)
      ON CONFLICT(user_id, action) DO UPDATE SET id = excluded.id, code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`)
      .bind(crypto.randomUUID(), session.user.id, codeHash, now + 10 * 60_000, new Date().toISOString()).run();
    try {
      await sendAccountDeletionEmail(session.user.email, session.workspace.name || session.user.name, code);
    } catch (error) {
      await db.prepare("DELETE FROM account_actions WHERE user_id = ? AND action = 'delete_account' AND code_hash = ?")
        .bind(session.user.id, codeHash).run();
      throw error;
    }
    await recordMonitoringEvent({
      category: "account_deletion_requested",
      severity: "info",
      route: new URL(request.url).pathname,
      message: "An account deletion confirmation code was requested.",
      actorHash: rateLimit.actorHash,
    });
    return Response.json({ ok: true, email: session.user.email });
  } catch (error) {
    await recordRouteError(request, "account_deletion_request_error", error);
    return Response.json({ error: error instanceof Error ? error.message : "A deletion code could not be sent." }, { status: 500 });
  }
}
