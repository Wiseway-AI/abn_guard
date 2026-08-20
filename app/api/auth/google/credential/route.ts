import { upsertGoogleUser } from "../../../../server/database";
import { sameOriginRequest } from "../../../../server/email-auth";
import { verifyGoogleIdToken } from "../../../../server/google-identity";
import { loginRateLimit, recordLoginFailure, recordRouteError } from "../../../../server/monitoring";
import { createSessionCookie } from "../../../../server/session";

export async function POST(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  if (!clientId || !process.env.SESSION_SECRET?.trim()) {
    return Response.json({ error: "Google sign-in is not configured yet." }, { status: 503 });
  }
  if (!sameOriginRequest(request)) {
    return Response.json({ error: "Google sign-in request was rejected." }, { status: 403 });
  }
  const rateLimit = await loginRateLimit(request, "google_signin", "google", 20, 15 * 60);
  if (!rateLimit.allowed) {
    await recordLoginFailure(request, "Google", "google", rateLimit.actorHash, true);
    return Response.json({ error: "Too many Google sign-in attempts. Try again later." }, { status: 429 });
  }
  try {
    const body = await request.json() as { credential?: string };
    if (!body.credential?.trim()) {
      return Response.json({ error: "Google did not return a sign-in credential." }, { status: 400 });
    }
    const profile = await verifyGoogleIdToken(body.credential, clientId);
    const account = await upsertGoogleUser({
      id: profile.sub!,
      email: profile.email!.toLowerCase(),
      name: profile.name?.trim() || profile.email!.split("@")[0],
      picture: profile.picture ?? "",
    });
    const headers = new Headers({ "Content-Type": "application/json" });
    if (!account) throw new Error("Your ABN Guard workspace could not be created.");
    headers.append("Set-Cookie", await createSessionCookie(account.user.id, request, account.user.session_version));
    return new Response(JSON.stringify({ authenticated: true }), { status: 200, headers });
  } catch (error) {
    await recordLoginFailure(request, "Google", "google", rateLimit.actorHash);
    if (!(error instanceof Error) || !/Google returned|Google sign-in|verified Google|different application/i.test(error.message)) {
      await recordRouteError(request, "google_signin_error", error);
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Google sign-in failed." },
      { status: 401 },
    );
  }
}
