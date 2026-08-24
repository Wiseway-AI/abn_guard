import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("configures the ABN Guard application shell and security headers", async () => {
  const [config, layout, page] = await Promise.all([
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(config, /output: "standalone"/);
  assert.match(config, /Strict-Transport-Security/);
  assert.match(config, /X-Content-Type-Options/);
  assert.match(config, /Referrer-Policy/);
  assert.match(config, /X-Frame-Options/);
  assert.match(config, /Cross-Origin-Opener-Policy/);
  assert.match(config, /Permissions-Policy/);
  const contentSecurityPolicy = config;
  assert.match(contentSecurityPolicy, /default-src 'self'/);
  assert.match(contentSecurityPolicy, /object-src 'none'/);
  assert.match(contentSecurityPolicy, /frame-ancestors 'none'/);
  assert.match(contentSecurityPolicy, /script-src[^;]+https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(contentSecurityPolicy, /frame-src https:\/\/accounts\.google\.com\/gsi\//);
  assert.doesNotMatch(contentSecurityPolicy, /'unsafe-eval'/);

  assert.match(layout, /<html lang="en-AU">/i);
  assert.match(layout, /ABN Guard · Supplier Verification/i);
  assert.match(
    layout,
    /Verify supplier ABNs, GST status and bank details, then monitor a secure cloud supplier register/i,
  );
  assert.match(page, /<div className="app-loading">Loading ABN Guard…<\/div>/i);
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
  assert.match(accountRoute, /process\.env\.JIAQI_PASSWORD/);
  assert.match(exampleEnv, /^ABN_LOOKUP_GUID=\s*$/m);
  assert.match(exampleEnv, /^ADMIN_PASSWORD=\s*$/m);
  assert.match(exampleEnv, /^BOW_PASSWORD=\s*$/m);
  assert.match(exampleEnv, /^GCGF_PASSWORD=\s*$/m);
  assert.match(exampleEnv, /^JIAQI_PASSWORD=\s*$/m);
  assert.doesNotMatch(page, /process\.env\.ABN_LOOKUP_GUID/);
  assert.doesNotMatch(page, /process\.env\.ADMIN_PASSWORD/);
  assert.doesNotMatch(page, /BOW_PASSWORD|GCGF_PASSWORD|JIAQI_PASSWORD/);
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
  assert.match(page, /Up to 10 ABN \/ bank-detail records/);
  assert.match(page, /Up to 100 ABN \/ bank-detail records/);
  assert.match(page, /A\$<\/span>9\.90<small>\/month \+ GST<\/small>/);
  assert.match(page, /Enterprise/);
  assert.match(page, /Custom record limits and onboarding/);
  assert.match(page, /Contact us/);
  assert.match(page, /Verify directly with the payee/);
  assert.match(page, /Do not rely only on the uploaded document/);
  assert.doesNotMatch(page, /Official ABN Lookup connected/);
  assert.doesNotMatch(page, /Documents stay in this browser/);
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
  assert.match(page, />Settings<\/b>/);
  assert.doesNotMatch(page, /mobile-only-nav/);
  assert.doesNotMatch(page, /<small>Stripe billing<\/small>/);
  assert.doesNotMatch(page, />Sign out<\/b>/);
  assert.match(styles, /\.sidebar-bottom\s*\{\s*display:\s*block;\s*padding-top:\s*6px/);
  assert.match(styles, /\.sidebar-bottom\s+\.sidebar-plan,\s*\.sidebar-bottom\s+\.account-card\s*\{\s*display:\s*none/);
});

test("opens Stripe Checkout without leaving the upgrade button stuck", async () => {
  const [page, checkoutRoute, syncRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/billing/checkout/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/billing/sync/route.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(checkoutRoute, /stripeRequest\("customers"/);
  assert.match(checkoutRoute, /checkoutParams\.set\("customer_email"/);
  assert.match(checkoutRoute, /billing_address_collection: "required"/);
  assert.match(checkoutRoute, /"automatic_tax\[enabled\]": "true"/);
  assert.match(syncRoute, /UPDATE users SET stripe_customer_id/);
  assert.match(page, /addEventListener\("pageshow", resetStripeNavigation\)/);
  assert.match(page, /controller\.abort\(\)/);
});

test("protects ABN lookups and publishes product trust pages", async () => {
  const [abnRoute, webhookRoute, page, privacy, terms, feedback] = await Promise.all([
    readFile(new URL("../app/api/abn/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/billing/webhook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/terms/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/feedback/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(abnRoute, /sessionFromRequest/);
  assert.match(abnRoute, /consumeRateLimit/);
  assert.match(webhookRoute, /stripe_events/);
  assert.match(webhookRoute, /stripe_event_created <= \?/);
  assert.match(page, /Feedback & support/);
  assert.match(page, /href="\/privacy"/);
  assert.match(page, /href="\/terms"/);
  assert.match(privacy, /Google for optional sign-in/);
  assert.match(terms, /verification aid/);
  assert.match(feedback, /storeFeedback/);
});
