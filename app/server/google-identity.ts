type GoogleIdTokenHeader = {
  alg?: string;
  kid?: string;
};

export type GoogleIdTokenPayload = {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  exp?: number;
  iat?: number;
};

type GoogleJwk = JsonWebKey & { kid?: string; alg?: string; use?: string };

let cachedKeys: { keys: GoogleJwk[]; expiresAt: number } | null = null;

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function decodeJson<T>(value: string) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

async function googleKeys(forceRefresh = false) {
  if (!forceRefresh && cachedKeys && cachedKeys.expiresAt > Date.now()) return cachedKeys.keys;
  const response = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!response.ok) throw new Error("Google's signing keys could not be loaded.");
  const body = await response.json() as { keys?: GoogleJwk[] };
  if (!body.keys?.length) throw new Error("Google did not return any signing keys.");
  const cacheControl = response.headers.get("Cache-Control") ?? "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] ?? 300);
  cachedKeys = { keys: body.keys, expiresAt: Date.now() + Math.max(60, maxAge) * 1000 };
  return body.keys;
}

async function signingKey(kid: string) {
  let keys = await googleKeys();
  let key = keys.find((candidate) => candidate.kid === kid);
  if (!key) {
    keys = await googleKeys(true);
    key = keys.find((candidate) => candidate.kid === kid);
  }
  if (!key) throw new Error("Google's signing key was not recognised.");
  return crypto.subtle.importKey(
    "jwk",
    key,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

export async function verifyGoogleIdToken(credential: string, clientId: string) {
  const parts = credential.split(".");
  if (parts.length !== 3) throw new Error("Google returned an invalid identity token.");
  const header = decodeJson<GoogleIdTokenHeader>(parts[0]);
  const payload = decodeJson<GoogleIdTokenPayload>(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Google returned an unsupported identity token.");
  const key = await signingKey(header.kid);
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!verified) throw new Error("Google sign-in could not be verified.");

  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") {
    throw new Error("Google returned an invalid token issuer.");
  }
  if (!audience.includes(clientId)) throw new Error("This Google sign-in was issued for a different application.");
  if (!payload.exp || payload.exp <= now) throw new Error("Google sign-in expired. Please try again.");
  if (payload.iat && payload.iat > now + 60) throw new Error("Google returned an invalid token timestamp.");
  if (!payload.sub || !payload.email || payload.email_verified !== true) {
    throw new Error("A verified Google email address is required.");
  }
  return payload;
}
