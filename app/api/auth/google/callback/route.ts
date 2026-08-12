import { upsertGoogleUser } from "../../../../server/database";
import { absoluteAppUrl, clearOauthStateCookie, createSessionCookie, validateOauthState } from "../../../../server/session";

type GoogleProfile = { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };

function redirectWithError(request: Request, message: string) {
  return new Response(null, { status: 302, headers: { Location: `${absoluteAppUrl(request)}/?auth_error=${encodeURIComponent(message)}`, "Set-Cookie": clearOauthStateCookie(request) } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || !(await validateOauthState(request, state))) return redirectWithError(request, "Google sign-in could not be verified. Please try again.");
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) return redirectWithError(request, "Google sign-in is not configured yet.");
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: `${absoluteAppUrl(request)}/api/auth/google/callback`, grant_type: "authorization_code" }),
    });
    const token = await tokenResponse.json() as { access_token?: string; error_description?: string };
    if (!tokenResponse.ok || !token.access_token) throw new Error(token.error_description || "Google did not return an access token.");
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` } });
    const profile = await profileResponse.json() as GoogleProfile;
    if (!profileResponse.ok || !profile.sub || !profile.email || profile.email_verified === false) throw new Error("A verified Google email address is required.");
    const account = await upsertGoogleUser({ id: profile.sub, email: profile.email.toLowerCase(), name: profile.name?.trim() || profile.email.split("@")[0], picture: profile.picture ?? "" });
    if (!account) throw new Error("Your ABN Guard workspace could not be created.");
    const headers = new Headers({ Location: absoluteAppUrl(request) });
    headers.append("Set-Cookie", await createSessionCookie(account.user.id, request));
    headers.append("Set-Cookie", clearOauthStateCookie(request));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    return redirectWithError(request, error instanceof Error ? error.message : "Google sign-in failed.");
  }
}
