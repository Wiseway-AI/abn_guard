import { absoluteAppUrl, createOauthStateCookie } from "../../../../server/session";

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET?.trim() || !process.env.SESSION_SECRET?.trim()) {
    return Response.json({ error: "Google sign-in is not configured yet." }, { status: 503 });
  }
  const state = crypto.randomUUID();
  const redirectUri = `${absoluteAppUrl(request)}/api/auth/google/callback`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": await createOauthStateCookie(state, request) } });
}
