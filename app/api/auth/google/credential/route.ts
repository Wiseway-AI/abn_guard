import { upsertGoogleUser } from "../../../../server/database";
import { verifyGoogleIdToken } from "../../../../server/google-identity";
import { createSessionCookie } from "../../../../server/session";

export async function POST(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  if (!clientId || !process.env.SESSION_SECRET?.trim()) {
    return Response.json({ error: "Google sign-in is not configured yet." }, { status: 503 });
  }
  const origin = request.headers.get("Origin");
  if (origin && new URL(origin).origin !== new URL(request.url).origin) {
    return Response.json({ error: "Google sign-in request was rejected." }, { status: 403 });
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
    headers.append("Set-Cookie", await createSessionCookie(account.user.id, request));
    return new Response(JSON.stringify({ authenticated: true }), { status: 200, headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Google sign-in failed." },
      { status: 401 },
    );
  }
}
