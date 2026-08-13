import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the ABN Guard application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="en-AU">/i);
  assert.match(html, /<title>ABN Guard · Supplier Verification<\/title>/i);
  assert.match(
    html,
    /Verify supplier ABNs, GST status and bank details, then monitor a secure cloud supplier register/i,
  );
  assert.match(html, /<div class="app-loading">Loading ABN Guard…<\/div>/i);
});

test("keeps service credentials on the server", async () => {
  const [route, accountRoute, page, exampleEnv] = await Promise.all([
    readFile(new URL("../app/api/abn/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/account-auth/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(route, /process\.env\.ABN_LOOKUP_GUID/);
  assert.match(accountRoute, /process\.env\.ADMIN_PASSWORD/);
  assert.match(accountRoute, /process\.env\.BOW_PASSWORD/);
  assert.match(accountRoute, /process\.env\.GCGF_PASSWORD/);
  assert.match(exampleEnv, /^ABN_LOOKUP_GUID=\s*$/m);
  assert.match(exampleEnv, /^ADMIN_PASSWORD=\s*$/m);
  assert.match(exampleEnv, /^BOW_PASSWORD=\s*$/m);
  assert.match(exampleEnv, /^GCGF_PASSWORD=\s*$/m);
  assert.doesNotMatch(page, /process\.env\.ABN_LOOKUP_GUID/);
  assert.doesNotMatch(page, /process\.env\.ADMIN_PASSWORD/);
  assert.doesNotMatch(page, /BOW_PASSWORD|GCGF_PASSWORD/);
});

test("presents Google and verified email as account-bound sign-in methods", async () => {
  const [page, credential, verifier, database, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/google/credential/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/server/google-identity.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/server/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Join now/);
  assert.match(page, /Join with Google/);
  assert.match(page, /Sign in with Google/);
  assert.match(page, /locale: "en"/);
  assert.match(page, /gsi\/client\?hl=en/);
  assert.match(page, /Google or email sign-in/);
  assert.match(page, /Create account with email/);
  assert.match(page, /Up to 30 ABN \/ bank-detail records/);
  assert.match(page, /Up to 500 ABN \/ bank-detail records/);
  assert.match(page, /Can not find your ABN\?/);
  assert.match(page, /https:\/\/abr\.business\.gov\.au\//);
  assert.match(credential, /upsertGoogleUser/);
  assert.match(credential, /createSessionCookie/);
  assert.match(verifier, /RSASSA-PKCS1-v1_5/);
  assert.match(verifier, /audience\.includes\(clientId\)/);
  assert.match(database, /WHERE owner_user_id = \?/);
  assert.match(database, /INSERT INTO workspaces/);
  assert.match(styles, /\.google-auth-button-host\.busy\s*>\s*div\s*\{\s*display:\s*none\s*!important/);
  assert.match(styles, /\.google-auth-button-host\.busy\s*>\s*span[\s\S]*text-overflow:\s*ellipsis/);
  assert.match(styles, /\/\* Mobile experience \*\/[\s\S]*max-height:\s*min\(92dvh,\s*820px\)/);
  assert.match(styles, /\.toolbar-actions\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(page, /mobile-only-nav/);
  assert.match(page, />Settings<\/b>/);
  assert.equal((page.match(/mobile-only-nav/g) ?? []).length, 2);
  assert.doesNotMatch(page, /<small>Stripe billing<\/small>/);
  assert.doesNotMatch(page, />Sign out<\/b>/);
});

test("opens Stripe Checkout without leaving the upgrade button stuck", async () => {
  const [page, checkoutRoute, syncRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/billing/checkout/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/billing/sync/route.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(checkoutRoute, /stripeRequest\("customers"/);
  assert.match(checkoutRoute, /checkoutParams\.set\("customer_email"/);
  assert.match(syncRoute, /UPDATE users SET stripe_customer_id/);
  assert.match(page, /addEventListener\("pageshow", resetStripeNavigation\)/);
  assert.match(page, /controller\.abort\(\)/);
});
