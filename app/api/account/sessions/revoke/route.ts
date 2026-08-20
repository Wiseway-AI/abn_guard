import { sameOriginRequest } from "../../../../server/email-auth.ts";
import { database } from "../../../../server/database.ts";
import { recordMonitoringEvent, recordRouteError } from "../../../../server/monitoring.ts";
import { clearSessionCookie, sessionFromRequest } from "../../../../server/session.ts";

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });
  try {
    const db = await database();
    await db.prepare("UPDATE users SET session_version = session_version + 1, updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), session.user.id).run();
    if (session.user.clerk_user_id) {
      const { clerkClient } = await import("@clerk/nextjs/server");
      const client = await clerkClient();
      const clerkSessions = await client.sessions.getSessionList({ userId: session.user.clerk_user_id, limit: 100 });
      await Promise.all(clerkSessions.data.map((clerkSession) => client.sessions.revokeSession(clerkSession.id)));
    }
    await recordMonitoringEvent({
      category: "sessions_revoked",
      severity: "info",
      route: new URL(request.url).pathname,
      message: "A user revoked all active account sessions.",
      metadata: { userId: session.user.id },
    });
    return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie(request) } });
  } catch (error) {
    await recordRouteError(request, "session_revocation_error", error);
    return Response.json({ error: "Your active sessions could not be revoked. Please try again." }, { status: 500 });
  }
}
