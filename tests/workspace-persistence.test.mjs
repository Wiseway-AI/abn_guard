import assert from "node:assert/strict";
import test from "node:test";

// Integration test against a real, migrated PostgreSQL database. Skipped unless TEST_DATABASE_URL is set:
//   TEST_DATABASE_URL=postgres://... npm run db:migrate && npm test
const databaseUrl = process.env.TEST_DATABASE_URL;

test("saves workspaces atomically with revision checks", { skip: !databaseUrl && "TEST_DATABASE_URL not set" }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const { database, loadWorkspace, saveWorkspaceState, WorkspaceConflictError, workspaceStateFromRows, parseWorkspaceState } = await import("../app/server/database.ts");
  const userId = `it-${crypto.randomUUID()}`;
  const workspaceId = `it-${crypto.randomUUID()}`;
  const db = await database();
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO users (id, email, name, picture, auth_provider, created_at, updated_at) VALUES (?, ?, 'A', '', 'clerk', ?, ?)").bind(userId, `${userId}@example.test`, now, now).run();
  const legacy = { account: { companyName: "Legacy Co" }, register: [{ abn: "11111111111", entityName: "One" }], schedule: "manual", lastRefresh: "" };
  await db.prepare("INSERT INTO workspaces (id, owner_user_id, name, plan, subscription_status, state_json, created_at, updated_at) VALUES (?, ?, 'W', 'free', 'free', ?, ?, ?)").bind(workspaceId, userId, JSON.stringify(legacy), now, now).run();

  // 1. Unmigrated workspace: falls back to state_json, revision null.
  let loaded = await loadWorkspace({ id: workspaceId });
  assert.equal(loaded.revision, null);
  assert.deepEqual(loaded.state.register, legacy.register);

  // 2. First save from null revision migrates to rows; state_json untouched.
  const s1 = { ...legacy, register: [...legacy.register, { abn: "22222222222", entityName: "Two" }] };
  const r1 = await saveWorkspaceState(workspaceId, s1, null);
  loaded = await loadWorkspace({ id: workspaceId });
  assert.equal(loaded.revision, r1);
  assert.equal((loaded.state.register).length, 2);
  const raw = await db.prepare("SELECT state_json FROM workspaces WHERE id = ?").bind(workspaceId).first();
  assert.deepEqual(JSON.parse(raw.state_json).register, legacy.register, "state_json no longer written");

  // 3. Previous release's reader (rows + stale state_json fallback) still sees the new data (rollback safety).
  const rows = (await db.prepare("SELECT namespace, item_id, data_json FROM workspace_data WHERE workspace_id = ?").bind(workspaceId).all()).results;
  const oldReader = workspaceStateFromRows(rows, parseWorkspaceState(raw.state_json));
  assert.equal((oldReader.register).length, 2);

  // 4. Stale base revision is rejected and nothing is written.
  await assert.rejects(saveWorkspaceState(workspaceId, { ...s1, register: [] }, null), WorkspaceConflictError);
  assert.equal(((await loadWorkspace({ id: workspaceId })).state.register).length, 2);

  // 5. Concurrent saves on the same base: exactly one wins.
  const results = await Promise.allSettled([
    saveWorkspaceState(workspaceId, { ...s1, register: [{ abn: "33333333333" }] }, r1),
    saveWorkspaceState(workspaceId, { ...s1, register: [{ abn: "44444444444" }] }, r1),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.ok(results.some((result) => result.status === "rejected" && result.reason instanceof WorkspaceConflictError));
  const after = await loadWorkspace({ id: workspaceId });
  assert.equal((after.state.register).length, 1);

  // 6. Clients without baseRevision (older cached JS) still save.
  const r3 = await saveWorkspaceState(workspaceId, { ...s1, register: [] });
  assert.equal((await loadWorkspace({ id: workspaceId })).revision, r3);

  // 7. Saving a workspace that does not exist fails inside the transaction.
  await assert.rejects(saveWorkspaceState("missing", s1), /Workspace not found/);
  await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
});
