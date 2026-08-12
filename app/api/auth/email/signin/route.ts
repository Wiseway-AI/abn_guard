import { database, type UserRow } from "../../../../server/database";
import { sameOriginRequest, validEmail, verifyPassword } from "../../../../server/email-auth";
import { createSessionCookie } from "../../../../server/session";

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return Response.json({ error: "Sign-in request was rejected." }, { status: 403 });
  try {
    const body = await request.json() as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 180) : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!validEmail(email) || !password) return Response.json({ error: "Email or password is incorrect." }, { status: 401 });
    const db = await database();
    const user = await db.prepare("SELECT id, email, name, picture, auth_provider, password_hash, email_verified_at, stripe_customer_id FROM users WHERE email = ?").bind(email).first<UserRow>();
    if (!user?.password_hash || !user.email_verified_at || !(await verifyPassword(password, user.password_hash))) {
      return Response.json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", await createSessionCookie(user.id, request));
    return new Response(JSON.stringify({ authenticated: true }), { status: 200, headers });
  } catch {
    return Response.json({ error: "Sign-in is temporarily unavailable." }, { status: 503 });
  }
}
