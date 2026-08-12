import { database, type EmailRegistrationRow } from "../../../../server/database";
import { hashVerificationCode, sameOriginRequest, validEmail, verificationCodeMatches } from "../../../../server/email-auth";
import { createSessionCookie } from "../../../../server/session";

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return Response.json({ error: "Verification request was rejected." }, { status: 403 });
  try {
    const body = await request.json() as { email?: unknown; code?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 180) : "";
    const code = typeof body.code === "string" ? body.code.replace(/\D/g, "").slice(0, 6) : "";
    if (!validEmail(email) || code.length !== 6) return Response.json({ error: "Enter the 6-digit code from your email." }, { status: 400 });
    const db = await database();
    const pending = await db.prepare("SELECT * FROM email_registrations WHERE email = ?").bind(email).first<EmailRegistrationRow>();
    if (!pending) return Response.json({ error: "This verification request has expired. Register again." }, { status: 404 });
    if (pending.expires_at < Date.now()) {
      await db.prepare("DELETE FROM email_registrations WHERE email = ?").bind(email).run();
      return Response.json({ error: "This code has expired. Register again for a new code." }, { status: 410 });
    }
    if (pending.attempts >= 6) return Response.json({ error: "Too many incorrect attempts. Register again for a new code." }, { status: 429 });
    const actualHash = await hashVerificationCode(email, code);
    if (!verificationCodeMatches(pending.code_hash, actualHash)) {
      await db.prepare("UPDATE email_registrations SET attempts = attempts + 1 WHERE email = ?").bind(email).run();
      return Response.json({ error: "That verification code is incorrect." }, { status: 400 });
    }
    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    if (existing) return Response.json({ error: "An account already exists for this email. Sign in instead." }, { status: 409 });

    const userId = `email-${crypto.randomUUID()}`;
    const workspaceId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`INSERT INTO users (id, email, name, picture, auth_provider, password_hash, email_verified_at, created_at, updated_at)
        VALUES (?, ?, ?, '', 'email', ?, ?, ?, ?)`).bind(userId, email, pending.company_name, pending.password_hash, now, now, now),
      db.prepare(`INSERT INTO workspaces (id, owner_user_id, name, plan, subscription_status, state_json, created_at, updated_at)
        VALUES (?, ?, ?, 'free', 'free', '{}', ?, ?)`).bind(workspaceId, userId, pending.company_name, now, now),
      db.prepare("DELETE FROM email_registrations WHERE email = ?").bind(email),
    ]);
    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", await createSessionCookie(userId, request));
    return new Response(JSON.stringify({ authenticated: true }), { status: 200, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Email verification failed." }, { status: 400 });
  }
}
