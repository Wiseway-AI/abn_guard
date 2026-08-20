import { database } from "../../server/database.ts";
import { recordRouteError } from "../../server/monitoring.ts";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json" };
  try {
    const db = await database();
    const result = await db.prepare("SELECT 1 AS healthy").first<{ healthy: number }>();
    if (result?.healthy !== 1) throw new Error("Database health check did not return a healthy response.");
    return new Response(JSON.stringify({ ok: true, service: "abn-guard", checkedAt: new Date().toISOString() }), { status: 200, headers });
  } catch (error) {
    await recordRouteError(request, "health_check_failed", error);
    return new Response(JSON.stringify({ ok: false, service: "abn-guard", checkedAt: new Date().toISOString() }), { status: 503, headers });
  }
}
