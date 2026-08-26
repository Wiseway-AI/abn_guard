import postgres from "postgres";
import { databaseUrlFromEnvironment } from "./database-url.mjs";

const databaseUrl = databaseUrlFromEnvironment();
const appUrl = process.env.APP_URL?.replace(/\/$/, "");
if (!appUrl) throw new Error("APP_URL is required.");

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 5 });
const rateLimitCutoff = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60;
const actionCutoff = Date.now();
const monitoringCutoff = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString();

try {
  const cleanup = sql.begin(async (transaction) => {
    await transaction`delete from rate_limits where window_start < ${rateLimitCutoff}`;
    await transaction`delete from account_actions where expires_at < ${actionCutoff}`;
    await transaction`delete from monitoring_events where created_at < ${monitoringCutoff}`;
  });
  const health = fetch(`${appUrl}/api/health`, {
    headers: { "User-Agent": "ABN-Guard-Maintenance/1.0", "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(15_000),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Health check returned HTTP ${response.status}.`);
    const result = await response.json();
    if (!result.ok) throw new Error("Health check returned an unhealthy response.");
  });
  await Promise.all([cleanup, health]);
  console.log("ABN Guard maintenance completed.");
} finally {
  await sql.end({ timeout: 5 });
}
