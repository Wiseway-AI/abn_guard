import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("renders the landing page on the server and keeps the workspace bundle under /app", async () => {
  const [landing, auth, workspace, proxy] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/landing-auth.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/workspace-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(landing, /^"use client"/);
  assert.doesNotMatch(landing, /from "\.\/workspace-app"/);
  assert.match(landing, /Catch the details that/);
  assert.match(landing, /<LegacyAuthDialog \/>/);
  assert.match(auth, /^"use client"/);
  assert.match(workspace, /^"use client"/);
  assert.doesNotMatch(workspace, /landing-shell/);
  // Signed-in visitors skip the landing page, except when sent back to sign in (avoids a redirect loop).
  assert.match(proxy, /pathname === "\/" && !searchParams\.has\("signin"\) && !searchParams\.has\("auth_error"\)/);
  assert.match(proxy, /abn_guard_session/);
  assert.match(proxy, /abn_guard_managed_session/);
});
