import { database, type EmailRegistrationRow } from "../../../../server/database";
import { hashPassword, hashVerificationCode, sameOriginRequest, sendVerificationEmail, validEmail, verificationCode } from "../../../../server/email-auth";

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return Response.json({ error: "Registration request was rejected." }, { status: 403 });
  try {
    const body = await request.json() as { companyName?: unknown; email?: unknown; password?: unknown };
    const companyName = clean(body.companyName, 120);
    const email = clean(body.email, 180).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    if (companyName.length < 2) return Response.json({ error: "Enter your company name." }, { status: 400 });
    if (!validEmail(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
    if (password.length < 8 || password.length > 72) return Response.json({ error: "Use a password between 8 and 72 characters." }, { status: 400 });

    const db = await database();
    const existingUser = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    if (existingUser) return Response.json({ error: "An account already exists for this email. Sign in instead." }, { status: 409 });
    const existing = await db.prepare("SELECT * FROM email_registrations WHERE email = ?").bind(email).first<EmailRegistrationRow>();
    const now = Date.now();
    if (existing && now - existing.last_sent_at < 60_000) {
      return Response.json({ error: "A code was sent recently. Wait a minute before requesting another." }, { status: 429 });
    }

    const code = verificationCode();
    const [passwordHash, codeHash] = await Promise.all([hashPassword(password), hashVerificationCode(email, code)]);
    const createdAt = existing?.created_at || new Date().toISOString();
    await db.prepare(`INSERT INTO email_registrations (email, company_name, password_hash, code_hash, expires_at, attempts, last_sent_at, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(email) DO UPDATE SET company_name = excluded.company_name, password_hash = excluded.password_hash, code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, last_sent_at = excluded.last_sent_at`)
      .bind(email, companyName, passwordHash, codeHash, now + 10 * 60_000, now, createdAt).run();
    try {
      await sendVerificationEmail(email, companyName, code);
    } catch (error) {
      await db.prepare("DELETE FROM email_registrations WHERE email = ? AND code_hash = ?").bind(email, codeHash).run();
      throw error;
    }
    return Response.json({ verificationRequired: true, email });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Registration could not be started." }, { status: 503 });
  }
}
