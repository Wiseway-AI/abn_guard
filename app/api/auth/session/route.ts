import { parseWorkspaceState, publicWorkspace, registerUsage } from "../../../server/database";
import { sessionFromRequest } from "../../../server/session";

export async function GET(request: Request) {
  const session = await sessionFromRequest(request);
  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim()
    && process.env.SESSION_SECRET?.trim(),
  );
  const googleClientId = googleConfigured ? process.env.GOOGLE_CLIENT_ID!.trim() : "";
  if (!session) return Response.json({ authenticated: false, googleConfigured, googleClientId });
  const state = parseWorkspaceState(session.workspace.state_json);
  return Response.json({
    authenticated: true,
    googleConfigured: true,
    googleClientId,
    user: { id: session.user.id, email: session.user.email, name: session.user.name, picture: session.user.picture, authProvider: session.user.auth_provider },
    workspace: publicWorkspace(session.workspace, registerUsage(state)),
  });
}
