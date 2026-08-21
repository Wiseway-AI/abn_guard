import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("integrates Clerk with visible controls and workspace-scoped D1 identities", async () => {
  const [layout, page, proxy, session, database, schema, migration, worker, packageJson] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/server/session.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/server/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0005_bitter_grandmaster.sql", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(packageJson, /"@clerk\/nextjs"/);
  assert.match(packageJson, /db:migrate:local/);
  assert.match(packageJson, /wrangler d1 migrations apply abn-guard-v2-db --local --persist-to \.wrangler\/state/);
  assert.match(packageJson, /wrangler dev --config dist\/server\/wrangler\.json --persist-to \.wrangler\/state/);
  assert.match(layout, /<body>[\s\S]*<ClerkProvider>[\s\S]*\{children\}[\s\S]*<\/ClerkProvider>[\s\S]*<\/body>/);
  assert.match(proxy, /clerkMiddleware\(\)/);
  assert.match(page, /SignInButton/);
  assert.match(page, /SignUpButton/);
  assert.match(page, /className="account-signout"[\s\S]*Sign out/);
  assert.match(page, /isLoaded: clerkLoaded, isSignedIn: clerkSignedIn, getToken: getClerkToken/);
  assert.match(page, /Authorization: `Bearer \$\{clerkToken\}`/);
  assert.match(page, /const attempts = clerkSignedIn \? 4 : 1/);
  assert.match(page, /We couldn’t open your workspace/);
  assert.match(page, /\[clerkLoaded, clerkSignedIn, getClerkToken\]/);
  assert.match(page, /!clerkSignedIn && !currentAccount && isAppPath/);
  assert.doesNotMatch(page, /CLERK_SECRET_KEY/);

  assert.match(session, /const clerkAuth = await auth\(\)/);
  assert.match(session, /options\.onClerkError\?\.\(error\)/);
  assert.match(session, /primaryEmail\?\.verification\?\.status !== "verified"/);
  assert.match(database, /WHERE clerk_user_id = \?/);
  assert.match(database, /existingEmail/);
  assert.match(schema, /clerkUserId: text\("clerk_user_id"\)/);
  assert.match(migration, /ADD `clerk_user_id` text/);
  assert.match(migration, /users_clerk_user_unique/);
  assert.match(worker, /https:\/\/\*\.clerk\.accounts\.dev/);
});
