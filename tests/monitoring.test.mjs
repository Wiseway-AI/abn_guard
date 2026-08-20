import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { errorMessage, maskedIdentifier } from "../app/server/monitoring.ts";

test("sanitises monitoring messages and account identifiers", () => {
  assert.equal(maskedIdentifier("person@example.com"), "pe***@example.com");
  assert.equal(maskedIdentifier("bow"), "bo***");
  assert.equal(errorMessage(new Error("failed\nwith secret-free context")), "failed with secret-free context");
});

test("records login, payment and availability failures with alert throttling", async () => {
  const [schema, migration, monitoring, managedSignIn, emailSignIn, webhook, health, worker, config] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0003_gorgeous_black_bolt.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/server/monitoring.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/account-auth/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/email/signin/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/billing/webhook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /monitoringEvents = sqliteTable\("monitoring_events"/);
  assert.match(migration, /CREATE TABLE `monitoring_events`/);
  assert.match(monitoring, /notified_at IS NOT NULL/);
  assert.match(managedSignIn, /loginRateLimit/);
  assert.match(emailSignIn, /recordLoginFailure/);
  assert.match(webhook, /invoice\.payment_failed/);
  assert.match(webhook, /stripe_payment_failed/);
  assert.match(health, /SELECT 1 AS healthy/);
  assert.match(worker, /checkPublicAvailability/);
  assert.match(worker, /cleanupOperationalData/);
  assert.match(config, /"\*\/5 \* \* \* \*"/);
});
