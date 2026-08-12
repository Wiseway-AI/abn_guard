import { database, parseWorkspaceState, publicWorkspace, registerUsage } from "../../server/database";
import { PLANS } from "../../server/plans";
import { sessionFromRequest } from "../../server/session";

const MAX_STATE_BYTES = 3_000_000;

export async function GET(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });
  const state = parseWorkspaceState(session.workspace.state_json);
  return Response.json({ state, workspace: publicWorkspace(session.workspace, registerUsage(state)) });
}

export async function PUT(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });
  try {
    const body = await request.json() as { state?: unknown };
    if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) return Response.json({ error: "Invalid workspace state." }, { status: 400 });
    const state = body.state as Record<string, unknown>;
    const usage = registerUsage(state);
    const limit = PLANS[session.workspace.plan]?.abnLimit ?? PLANS.free.abnLimit;
    if (usage > limit) return Response.json({ error: `Your ${PLANS[session.workspace.plan]?.name ?? "Free"} plan allows ${limit} saved ABNs.`, code: "quota_exceeded", usage, limit }, { status: 409 });
    const json = JSON.stringify(state);
    if (new TextEncoder().encode(json).byteLength > MAX_STATE_BYTES) return Response.json({ error: "Workspace data is too large to save." }, { status: 413 });
    const db = await database();
    await db.prepare("UPDATE workspaces SET state_json = ?, updated_at = ? WHERE id = ?").bind(json, new Date().toISOString(), session.workspace.id).run();
    return Response.json({ ok: true, workspace: publicWorkspace(session.workspace, usage) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Workspace could not be saved." }, { status: 400 });
  }
}
