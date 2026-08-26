import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("integrates Clerk with visible controls and PostgreSQL-scoped identities", async () => {
  const [layout, page, proxy, session, database, schema, migration, nextConfig, packageJson, dockerfile, deployWorkflow] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/server/session.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/server/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle-pg/0000_initial.sql", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
  ]);

  assert.match(packageJson, /"@clerk\/nextjs"/);
  assert.match(packageJson, /"db:migrate"/);
  assert.match(packageJson, /next dev --port 3001/);
  assert.match(layout, /<body>[\s\S]*<ClerkProvider>[\s\S]*\{children\}[\s\S]*<\/ClerkProvider>[\s\S]*<\/body>/);
  assert.match(proxy, /clerkMiddleware\(\)/);
  assert.match(page, /SignInButton/);
  assert.match(page, /SignUpButton/);
  assert.match(page, /className="account-signout"[\s\S]*Sign out/);
  assert.match(page, /isLoaded: clerkLoaded, isSignedIn: clerkSignedIn/);
  assert.match(page, /\[clerkLoaded, clerkSignedIn\]/);
  assert.match(page, /!clerkSignedIn && !currentAccount && isAppPath/);
  assert.doesNotMatch(page, /CLERK_SECRET_KEY/);

  assert.match(session, /const clerkAuth = await auth\(\)/);
  assert.match(session, /primaryEmail\?\.verification\?\.status !== "verified"/);
  assert.match(database, /WHERE clerk_user_id = \?/);
  assert.match(database, /existingEmail/);
  assert.match(schema, /clerkUserId: text\("clerk_user_id"\)/);
  assert.match(migration, /clerk_user_id text/);
  assert.match(migration, /users_clerk_user_unique/);
  assert.match(nextConfig, /https:\/\/\*\.clerk\.accounts\.dev/);
  assert.match(dockerfile, /ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/);
  assert.match(dockerfile, /ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=\$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/);
  assert.match(deployWorkflow, /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=\$\{\{ secrets\.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \}\}/);
  assert.match(deployWorkflow, /runs-on: ubuntu-24\.04-arm/);
  assert.doesNotMatch(deployWorkflow, /setup-qemu-action/);
});
