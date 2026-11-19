import { loadWorkspaceState, publicWorkspace, registerUsage } from "../../../server/database";
import { sessionFromRequest } from "../../../server/session";

export async function GET(request: Request) {
  const session = await sessionFromRequest(request);
  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim()
    && process.env.SESSION_SECRET?.trim(),
  );
  const googleClientId = googleConfigured ? process.env.GOOGLE_CLIENT_ID!.trim() : "";
  // Service flags ride along with the session so the client needs no separate config requests.
  const services = {
    abnConfigured: Boolean(process.env.ABN_LOOKUP_GUID?.trim()),
    vlmConfigured: Boolean(process.env.VLM_API_URL?.trim()),
  };
  const headers = { "Cache-Control": "no-store, max-age=0" };
  if (!session) return Response.json({ authenticated: false, googleConfigured, googleClientId, ...services }, { headers });
  const state = await loadWorkspaceState(session.workspace);
  return Response.json({
    authenticated: true,
    googleConfigured: true,
    googleClientId,
    ...services,
    user: { id: session.user.id, email: session.user.email, name: session.user.name, picture: session.user.picture, authProvider: session.user.auth_provider },
    workspace: publicWorkspace(session.workspace, registerUsage(state)),
    // The workspace state is already loaded for the usage count; return it to avoid a second load.
    state,
  }, { headers });
}
