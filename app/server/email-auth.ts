const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 100_000;

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function derivePassword(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = Uint8Array.from(salt).buffer;
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations: PASSWORD_ITERATIONS }, key, 256));
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const digest = await derivePassword(password, salt);
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(digest)}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, iterations, saltValue, digestValue] = stored.split("$");
  if (algorithm !== "pbkdf2_sha256" || iterations !== String(PASSWORD_ITERATIONS) || !saltValue || !digestValue) return false;
  const padded = saltValue.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((saltValue.length + 3) % 4);
  const salt = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  return safeEqual(bytesToBase64(await derivePassword(password, salt)), digestValue);
}

export function verificationCode() {
  const bytes = randomBytes(4);
  const value = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(value % 1_000_000).padStart(6, "0");
}

export async function hashVerificationCode(email: string, code: string) {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error("SESSION_SECRET is not configured.");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${email}:${code}`))));
}

export function verificationCodeMatches(expected: string, actual: string) {
  return safeEqual(expected, actual);
}

export async function sendVerificationEmail(email: string, companyName: string, code: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.AUTH_FROM_EMAIL?.trim();
  if (!apiKey || !from) throw new Error("Email verification is not configured yet.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `${code} is your ABN Guard verification code`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#071b33"><div style="font-weight:800;font-size:18px;color:#1746d1">ABN Guard</div><h1 style="font-size:26px;margin:28px 0 12px">Verify your email</h1><p style="line-height:1.6;color:#52637a">Hi ${escapeHtml(companyName)}, use this code to finish creating your company workspace.</p><div style="margin:28px 0;padding:20px;border-radius:14px;background:#edf3ff;color:#1746d1;font-size:32px;font-weight:800;letter-spacing:8px;text-align:center">${code}</div><p style="line-height:1.6;color:#52637a">This code expires in 10 minutes. If you did not request it, you can safely ignore this email.</p></div>`,
      text: `Your ABN Guard verification code is ${code}. It expires in 10 minutes.`,
    }),
  });
  if (!response.ok) {
    throw new Error("Email verification is being activated. Please try again shortly.");
  }
}

export async function sendAccountDeletionEmail(email: string, companyName: string, code: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.AUTH_FROM_EMAIL?.trim();
  if (!apiKey || !from) throw new Error("Account security email is not configured yet.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `${code} confirms deletion of your ABN Guard account`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#071b33"><div style="font-weight:800;font-size:18px;color:#1746d1">ABN Guard</div><h1 style="font-size:26px;margin:28px 0 12px">Confirm permanent account deletion</h1><p style="line-height:1.6;color:#52637a">Hi ${escapeHtml(companyName)}, enter this code in ABN Guard only if you requested permanent deletion of your account and workspace.</p><div style="margin:28px 0;padding:20px;border-radius:14px;background:#fff2f0;color:#b42318;font-size:32px;font-weight:800;letter-spacing:8px;text-align:center">${code}</div><p style="line-height:1.6;color:#52637a">This code expires in 10 minutes. Deletion cancels any active subscription immediately and cannot be undone. If you did not request this, change your password and contact support.</p></div>`,
      text: `Your ABN Guard account deletion code is ${code}. It expires in 10 minutes. Deletion cannot be undone. If you did not request this, contact support.`,
    }),
  });
  if (!response.ok) throw new Error("The account security email could not be sent. Please try again shortly.");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function sameOriginRequest(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;

  const allowedOrigins = new Set([new URL(request.url).origin]);
  const configuredAppUrl = process.env.APP_URL?.trim();
  if (configuredAppUrl) {
    try {
      allowedOrigins.add(new URL(configuredAppUrl).origin);
    } catch {
      return false;
    }
  }
  return allowedOrigins.has(origin);
}
