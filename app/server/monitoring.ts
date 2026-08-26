import { consumeRateLimit, database } from "./database.ts";
import { sendSupportEmail } from "./support.ts";

export type MonitoringSeverity = "info" | "warning" | "critical";

type MonitoringInput = {
  category: string;
  severity?: MonitoringSeverity;
  route?: string;
  message: string;
  actorHash?: string;
  metadata?: Record<string, string | number | boolean | null>;
  notify?: boolean;
};

const encoder = new TextEncoder();

function limited(value: string, length: number) {
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, length);
}

function clientAddress(request: Request) {
  return request.headers.get("CF-Connecting-IP")
    || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    || "unknown";
}

export function errorMessage(error: unknown) {
  return limited(error instanceof Error ? error.message : "Unknown operational error", 500);
}

export function maskedIdentifier(value: string) {
  const clean = value.trim();
  const at = clean.indexOf("@");
  if (at > 1) return `${clean.slice(0, 2)}***${clean.slice(at)}`;
  return clean ? `${clean.slice(0, 2)}***` : "unknown";
}

export async function monitoringActorKey(request: Request, identifier = "") {
  const secret = process.env.SESSION_SECRET?.trim() || "abn-guard-monitoring";
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const value = `${clientAddress(request)}:${identifier.trim().toLowerCase()}`;
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function loginRateLimit(request: Request, scope: string, identifier: string, limit = 10, windowSeconds = 15 * 60) {
  const actorHash = await monitoringActorKey(request, identifier);
  try {
    const result = await consumeRateLimit(scope, actorHash, limit, windowSeconds);
    return { ...result, actorHash };
  } catch {
    // Authentication already depends on D1 for public accounts. Managed beta
    // accounts remain available if the monitoring store has a transient issue.
    return { allowed: true, remaining: limit, resetAt: 0, actorHash };
  }
}

export async function recordMonitoringEvent(input: MonitoringInput) {
  try {
    const db = await database();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const category = limited(input.category, 80) || "application_error";
    const route = limited(input.route ?? "", 180);
    const message = limited(input.message, 500) || "Unknown operational error";
    const metadataJson = JSON.stringify(input.metadata ?? {}).slice(0, 2_000);
    await db.prepare(`INSERT INTO monitoring_events (id, category, severity, route, message, actor_hash, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, category, input.severity ?? "warning", route, message, input.actorHash ?? "", metadataJson, now).run();

    if (!input.notify) return id;
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const recent = await db.prepare(`SELECT id FROM monitoring_events
      WHERE category = ? AND route = ? AND notified_at IS NOT NULL AND created_at >= ? LIMIT 1`)
      .bind(category, route, since).first<{ id: string }>();
    if (recent) return id;

    await sendSupportEmail({
      subject: `[ABN Guard ${input.severity === "critical" ? "critical" : "warning"}] ${category}`,
      fields: [
        ["Severity", input.severity ?? "warning"],
        ["Category", category],
        ["Route", route || "Not supplied"],
        ["Message", message],
        ["Environment", process.env.APP_URL?.trim() || "Unknown"],
        ["Time", now],
      ],
    });
    await db.prepare("UPDATE monitoring_events SET notified_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
    return id;
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== "ERR_UNSUPPORTED_ESM_URL_SCHEME") {
      console.error("ABN Guard monitoring event could not be stored", error);
    }
    return null;
  }
}

export async function recordLoginFailure(request: Request, source: string, identifier: string, actorHash: string, blocked = false) {
  return recordMonitoringEvent({
    category: "login_failure",
    severity: blocked ? "critical" : "warning",
    route: new URL(request.url).pathname,
    message: blocked ? `Repeated ${source} login failures were blocked.` : `${source} sign-in was rejected.`,
    actorHash,
    metadata: { source, account: maskedIdentifier(identifier), blocked },
    notify: blocked,
  });
}

export async function recordRouteError(request: Request, category: string, error: unknown, notify = true) {
  return recordMonitoringEvent({
    category,
    severity: "critical",
    route: new URL(request.url).pathname,
    message: errorMessage(error),
    metadata: { method: request.method },
    notify,
  });
}
