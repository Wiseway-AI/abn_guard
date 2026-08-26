/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  APP_URL?: string;
  RESEND_API_KEY?: string;
  AUTH_FROM_EMAIL?: string;
  CONTACT_TO_EMAIL?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client https://*.clerk.accounts.dev https://*.clerk.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://img.clerk.com",
  "font-src 'self' data:",
  "connect-src 'self' https://accounts.google.com/gsi/ https://*.clerk.accounts.dev https://*.clerk.com",
  "frame-src https://accounts.google.com/gsi/ https://*.clerk.accounts.dev https://*.clerk.com",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

function withSecurityHeaders(response: Response) {
  const secured = new Response(response.body, response);
  secured.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  secured.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  secured.headers.set("X-Frame-Options", "DENY");
  secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()");
  secured.headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  secured.headers.set("X-Permitted-Cross-Domain-Policies", "none");
  secured.headers.set("Origin-Agent-Cluster", "?1");
  return secured;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return withSecurityHeaders(response);
    }

    try {
      return withSecurityHeaders(await handler.fetch(request, env, ctx));
    } catch (error) {
      ctx.waitUntil(recordWorkerFailure(env, "unhandled_worker_error", url.pathname, error, true));
      const acceptsJson = request.headers.get("Accept")?.includes("application/json") || url.pathname.startsWith("/api/");
      const response = acceptsJson
        ? Response.json({ error: "ABN Guard is temporarily unavailable." }, { status: 500 })
        : new Response("ABN Guard is temporarily unavailable.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      return withSecurityHeaders(response);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([checkPublicAvailability(env), cleanupOperationalData(env)]));
  },
};

function operationalMessage(error: unknown) {
  return (error instanceof Error ? error.message : "Unknown worker error").replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

async function recordWorkerFailure(env: Env, category: string, route: string, error: unknown, notify: boolean) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const message = operationalMessage(error);
  try {
    await env.DB.prepare(`INSERT INTO monitoring_events (id, category, severity, route, message, actor_hash, metadata_json, created_at)
      VALUES (?, ?, 'critical', ?, ?, '', '{}', ?)`)
      .bind(id, category, route.slice(0, 180), message, now).run();
    if (!notify) return;
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const recent = await env.DB.prepare(`SELECT id FROM monitoring_events
      WHERE category = ? AND route = ? AND notified_at IS NOT NULL AND created_at >= ? LIMIT 1`)
      .bind(category, route.slice(0, 180), since).first<{ id: string }>();
    if (recent || !env.RESEND_API_KEY || !env.AUTH_FROM_EMAIL || !env.CONTACT_TO_EMAIL) return;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.AUTH_FROM_EMAIL,
        to: [env.CONTACT_TO_EMAIL],
        subject: `[ABN Guard critical] ${category}`,
        text: `Category: ${category}\nRoute: ${route}\nMessage: ${message}\nTime: ${now}`,
      }),
    });
    if (response.ok) await env.DB.prepare("UPDATE monitoring_events SET notified_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
  } catch (monitoringError) {
    console.error("ABN Guard worker monitoring failed", monitoringError);
  }
}

async function checkPublicAvailability(env: Env) {
  const baseUrl = env.APP_URL?.replace(/\/$/, "");
  if (!baseUrl) return;
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { "User-Agent": "ABN-Guard-Uptime-Monitor/1.0", "Cache-Control": "no-cache" },
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`Public health check returned HTTP ${response.status}.`);
    const result = await response.json() as { ok?: boolean };
    if (!result.ok) throw new Error("Public health check returned an unhealthy response.");
  } catch (error) {
    await recordWorkerFailure(env, "public_uptime_failed", "/api/health", error, true);
  }
}

async function cleanupOperationalData(env: Env) {
  try {
    const rateLimitCutoff = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60;
    const monitoringCutoff = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(rateLimitCutoff),
      env.DB.prepare("DELETE FROM account_actions WHERE expires_at < ?").bind(Date.now()),
      env.DB.prepare("DELETE FROM monitoring_events WHERE created_at < ?").bind(monitoringCutoff),
    ]);
  } catch (error) {
    await recordWorkerFailure(env, "monitoring_cleanup_failed", "scheduled", error, false);
  }
}

export default worker;
