import { sameOriginRequest } from "../../server/email-auth";
import { managedSessionFromRequest, sessionFromRequest } from "../../server/session";
import { recordRouteError } from "../../server/monitoring";
import { sendSupportEmail, storeFeedback } from "../../server/support";

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(request: Request) {
  try {
    if (!sameOriginRequest(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    const cloudSession = await sessionFromRequest(request);
    const managedSession = cloudSession ? null : await managedSessionFromRequest(request);
    if (!cloudSession && !managedSession) return Response.json({ error: "Sign in to send feedback." }, { status: 401 });

    const body = (await request.json()) as { category?: string; message?: string; pageUrl?: string };
    const category = clean(body.category, 40) || "feedback";
    const message = clean(body.message, 3_000);
    const pageUrl = clean(body.pageUrl, 500);
    if (message.length < 5) return Response.json({ error: "Tell us a little more so we can help." }, { status: 400 });

    const actorId = cloudSession?.user.id ?? managedSession!.managedAccountId;
    const workspaceId = cloudSession?.workspace.id ?? null;
    const email = cloudSession?.user.email ?? "managed account";
    await storeFeedback({ actorId, workspaceId, email, category, message, pageUrl });
    await Promise.allSettled([sendSupportEmail({
      subject: `ABN Guard ${category} — ${email}`,
      replyTo: cloudSession?.user.email,
      fields: [["Category", category], ["Account", actorId], ["Email", email], ["Message", message], ["Page", pageUrl || "Unknown"], ["Submitted", new Date().toISOString()]],
    })]);
    return Response.json({ ok: true });
  } catch (error) {
    await recordRouteError(request, "feedback_save_error", error);
    return Response.json({ error: "Your feedback could not be saved. Please try again." }, { status: 502 });
  }
}
