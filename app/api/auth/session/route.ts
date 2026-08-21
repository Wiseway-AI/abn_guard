import { loadWorkspaceState, publicWorkspace, registerUsage } from "../../../server/database";
import { recordRouteError } from "../../../server/monitoring";
import { sessionFromRequest } from "../../../server/session";

export async function GET(request: Request) {
  let clerkError: unknown;
  const session = await sessionFromRequest(request, { onClerkError: (error) => { clerkError = error; } });
  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim()
    && process.env.SESSION_SECRET?.trim(),
  );
  const googleClientId = googleConfigured ? process.env.GOOGLE_CLIENT_ID!.trim() : "";
  const responseHeaders = { "Cache-Control": "no-store" };
  if (!session) {
    if (clerkError && request.headers.get("Authorization")?.startsWith("Bearer ")) {
      await recordRouteError(request, "clerk_session_failed", clerkError, false);
      return Response.json({
        authenticated: false,
        error: "Your sign-in succeeded, but the workspace could not be opened. Please try again.",
      }, { status: 503, headers: responseHeaders });
    }
    return Response.json({ authenticated: false, googleConfigured, googleClientId }, { headers: responseHeaders });
  }
  try {
    const state = await loadWorkspaceState(session.workspace);
    return Response.json({
      authenticated: true,
      googleConfigured: true,
      googleClientId,
      user: { id: session.user.id, email: session.user.email, name: session.user.name, picture: session.user.picture, authProvider: session.user.auth_provider },
      workspace: publicWorkspace(session.workspace, registerUsage(state)),
    }, { headers: responseHeaders });
  } catch (error) {
    await recordRouteError(request, "workspace_session_failed", error, false);
    return Response.json({
      authenticated: false,
      error: "Your sign-in succeeded, but the workspace could not be opened. Please try again.",
    }, { status: 503, headers: responseHeaders });
  }
}
