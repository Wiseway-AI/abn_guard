import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { workspaceStateFromRows, workspaceStateRows } from "../app/server/database.ts";

const marker = { namespace: "meta", item_id: "state", data_json: JSON.stringify({ version: 1 }) };

test("stores workspace collections as independent records and restores their order", () => {
  const state = {
    account: { companyName: "Example Pty Ltd", ownAbn: "11111111111" },
    register: [{ abn: "22222222222", entityName: "Second" }, { abn: "11111111111", entityName: "First" }],
    changes: [{ id: "change-1", description: "GST changed" }],
    history: [{ id: "history-1", event: "Added to register" }],
    today: [{ id: "review-1", status: "verified" }],
    schedule: "manual",
    lastRefresh: "2026-08-18T00:00:00.000Z",
  };

  const rows = workspaceStateRows(state);
  assert.equal(rows.filter((row) => row.namespace === "register").length, 2);
  assert.ok(rows.some((row) => row.namespace === "register" && row.item_id === "22222222222"));
  assert.ok(rows.some((row) => row.namespace === "today" && row.item_id === "review-1"));

  const restored = workspaceStateFromRows([marker, ...rows].reverse(), { legacyFlag: true });
  assert.deepEqual(restored.register, state.register);
  assert.deepEqual(restored.changes, state.changes);
  assert.deepEqual(restored.history, state.history);
  assert.deepEqual(restored.today, state.today);
  assert.deepEqual(restored.account, state.account);
  assert.equal(restored.schedule, "manual");
  assert.equal(restored.lastRefresh, state.lastRefresh);
  assert.equal(restored.legacyFlag, true);
});

test("uses legacy state until the independent-record completion marker exists", () => {
  const fallback = { register: [{ abn: "99999999999" }], schedule: "weekly" };
  assert.strictEqual(workspaceStateFromRows(workspaceStateRows({ register: [] }), fallback), fallback);

  const restored = workspaceStateFromRows([marker, ...workspaceStateRows({ register: [] })], fallback);
  assert.deepEqual(restored.register, []);
});

test("defines authenticated app URLs and an additive workspace-data migration", async () => {
  const [page, appRoute, schema, migration, workspaceRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/app/[[...section]]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle-pg/0000_initial.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
  ]);

  for (const path of ["/app/check", "/app/review", "/app/records", "/app/alerts", "/app/settings"]) {
    assert.match(page, new RegExp(path.replaceAll("/", "\\/")));
  }
  assert.match(appRoute, /import Home from "\.\.\/\.\.\/page"/);
  assert.match(schema, /workspaceData = pgTable\("workspace_data"/);
  assert.match(migration, /create table workspace_data/i);
  assert.match(workspaceRoute, /saveWorkspaceState/);
});
