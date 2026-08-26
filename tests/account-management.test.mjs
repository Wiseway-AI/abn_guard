import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("supports revocable sessions and verified permanent account deletion", async () => {
  const [schema, migration, session, revokeRoute, requestRoute, deleteRoute, page] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0003_gorgeous_black_bolt.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/server/session.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/account/sessions/revoke/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/account/delete/request/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/account/delete/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /sessionVersion: integer\("session_version"\)/);
  assert.match(schema, /accountActions = sqliteTable\("account_actions"/);
  assert.match(migration, /ALTER TABLE `users` ADD `session_version`/);
  assert.match(migration, /CREATE TABLE `account_actions`/);
  assert.match(session, /account\.user\.session_version !== \(payload\.version \?\? 0\)/);
  assert.match(revokeRoute, /session_version = session_version \+ 1/);
  assert.match(requestRoute, /sendAccountDeletionEmail/);
  assert.match(deleteRoute, /verificationCodeMatches/);
  assert.match(deleteRoute, /stripeDelete/);
  assert.match(deleteRoute, /DELETE FROM workspaces/);
  assert.match(deleteRoute, /DELETE FROM users/);
  assert.doesNotMatch(page, /Sign out all devices/);
  assert.doesNotMatch(page, /Delete account and data/);
  assert.doesNotMatch(page, /Permanently delete account/);
});
