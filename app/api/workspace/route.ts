import { loadWorkspace, publicWorkspace, registerUsage, saveWorkspaceState, WorkspaceConflictError } from "../../server/database";
import { PLANS } from "../../server/plans";
import { recordRouteError } from "../../server/monitoring";
import { BodyTooLargeError, readJsonBody } from "../../server/request-body";
import { sessionFromRequest } from "../../server/session";

const MAX_STATE_BYTES = 3_000_000;

export async function GET(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });
  const { state, revision } = await loadWorkspace(session.workspace);
  return Response.json({ state, revision, workspace: publicWorkspace(session.workspace, registerUsage(state)) });
}

export async function PUT(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });
  try {
    // The state is capped at MAX_STATE_BYTES; allow a little extra for the JSON wrapper.
    const body = await readJsonBody<{ state?: unknown; baseRevision?: unknown }>(request, MAX_STATE_BYTES + 64_000);
    if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) return Response.json({ error: "Invalid workspace state." }, { status: 400 });
    const state = body.state as Record<string, unknown>;
    const usage = registerUsage(state);
    const limit = PLANS[session.workspace.plan]?.abnLimit ?? PLANS.free.abnLimit;
    if (usage > limit) return Response.json({ error: `Your ${PLANS[session.workspace.plan]?.name ?? "Free"} plan allows ${limit} saved ABNs.`, code: "quota_exceeded", usage, limit }, { status: 409 });
    const json = JSON.stringify(state);
    if (new TextEncoder().encode(json).byteLength > MAX_STATE_BYTES) return Response.json({ error: "Workspace data is too large to save." }, { status: 413 });
    // Older cached clients omit baseRevision; they keep last-write-wins behaviour.
    const baseRevision = body.baseRevision === undefined ? undefined : typeof body.baseRevision === "string" ? body.baseRevision : null;
    const revision = await saveWorkspaceState(session.workspace.id, state, baseRevision);
    return Response.json({ ok: true, revision, workspace: publicWorkspace(session.workspace, usage) });
  } catch (error) {
    if (error instanceof WorkspaceConflictError) return Response.json({ error: error.message, code: "workspace_conflict" }, { status: 409 });
    if (error instanceof BodyTooLargeError) return Response.json({ error: "Workspace data is too large to save." }, { status: 413 });
    await recordRouteError(request, "workspace_save_error", error);
    return Response.json({ error: error instanceof Error ? error.message : "Workspace could not be saved." }, { status: 400 });
  }
}
