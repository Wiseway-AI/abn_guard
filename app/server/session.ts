import { getClerkUserWorkspace, getUserWorkspace, upsertClerkUser } from "./database.ts";

const SESSION_COOKIE = "abn_guard_session";
const MANAGED_SESSION_COOKIE = "abn_guard_managed_session";
const OAUTH_STATE_COOKIE = "abn_guard_oauth_state";
const encoder = new TextEncoder();

export type SessionPayload = { userId: string; version: number; exp: number };
export type ManagedSessionPayload = { managedAccountId: string; exp: number };

function secret() {
  const value = process.env.SESSION_SECRET?.trim();
  if (!value) throw new Error("SESSION_SECRET is not configured.");
  return value;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signature(value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

async function signed(value: string) {
  return `${value}.${await signature(value)}`;
}

async function verifySigned(value: string) {
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = value.slice(0, separator);
  const expected = await signature(payload);
  if (expected.length !== value.length - separator - 1) return null;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ value.charCodeAt(separator + 1 + index);
  return difference === 0 ? payload : null;
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("Cookie") ?? "";
  for (const item of cookies.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return "";
}

function cookie(name: string, value: string, maxAge: number, secure: boolean) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export async function createSessionCookie(userId: string, request: Request, sessionVersion = 0) {
  const payload: SessionPayload = { userId, version: sessionVersion, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14 };
  const token = await signed(base64Url(encoder.encode(JSON.stringify(payload))));
  return cookie(SESSION_COOKIE, token, 60 * 60 * 24 * 14, new URL(request.url).protocol === "https:");
}

export function clearSessionCookie(request: Request) {
  return cookie(SESSION_COOKIE, "", 0, new URL(request.url).protocol === "https:");
}

export async function createManagedSessionCookie(managedAccountId: string, request: Request) {
  const payload: ManagedSessionPayload = { managedAccountId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14 };
  const token = await signed(base64Url(encoder.encode(JSON.stringify(payload))));
  return cookie(MANAGED_SESSION_COOKIE, token, 60 * 60 * 24 * 14, new URL(request.url).protocol === "https:");
}

export function clearManagedSessionCookie(request: Request) {
  return cookie(MANAGED_SESSION_COOKIE, "", 0, new URL(request.url).protocol === "https:");
}

export async function managedSessionFromRequest(request: Request) {
  try {
    const encoded = await verifySigned(cookieValue(request, MANAGED_SESSION_COOKIE));
    if (!encoded) return null;
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((encoded.length + 3) % 4);
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)))) as ManagedSessionPayload;
    if (!payload.managedAccountId || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function sessionFromRequest(request: Request) {
  try {
    const { auth, currentUser } = await import("@clerk/nextjs/server");
    const clerkAuth = await auth();
    if (clerkAuth.userId) {
      const existing = await getClerkUserWorkspace(clerkAuth.userId);
      if (existing) return existing;
      const clerkUser = await currentUser();
      const primaryEmail = clerkUser?.primaryEmailAddress;
      const email = primaryEmail?.emailAddress?.trim().toLowerCase();
      if (!clerkUser || !email || primaryEmail?.verification?.status !== "verified") return null;
      return upsertClerkUser({
        clerkUserId: clerkUser.id,
        email,
        name: clerkUser.fullName || clerkUser.firstName || email.split("@")[0],
        picture: clerkUser.imageUrl || "",
      });
    }
  } catch {
    // Keep legacy sessions working while Clerk is being configured or during migration.
  }
  try {
    const encoded = await verifySigned(cookieValue(request, SESSION_COOKIE));
    if (!encoded) return null;
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((encoded.length + 3) % 4);
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)))) as SessionPayload;
    if (!payload.userId || payload.exp < Math.floor(Date.now() / 1000)) return null;
    const account = await getUserWorkspace(payload.userId);
    if (!account || account.user.session_version !== (payload.version ?? 0)) return null;
    return account;
  } catch {
    return null;
  }
}

export async function createOauthStateCookie(state: string, request: Request) {
  return cookie(OAUTH_STATE_COOKIE, await signed(state), 10 * 60, new URL(request.url).protocol === "https:");
}

export async function validateOauthState(request: Request, state: string) {
  const value = await verifySigned(cookieValue(request, OAUTH_STATE_COOKIE));
  return Boolean(state && value === state);
}

export function clearOauthStateCookie(request: Request) {
  return cookie(OAUTH_STATE_COOKIE, "", 0, new URL(request.url).protocol === "https:");
}

export function absoluteAppUrl(request: Request) {
  return (process.env.APP_URL?.trim() || new URL(request.url).origin).replace(/\/$/, "");
}
