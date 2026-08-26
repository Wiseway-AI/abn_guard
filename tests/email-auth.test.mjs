import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { hashPassword, sameOriginRequest, validEmail, verificationCode, verifyPassword } from "../app/server/email-auth.ts";

test("hashes email-account passwords with a unique PBKDF2 salt", async () => {
  const first = await hashPassword("correct horse battery staple");
  const second = await hashPassword("correct horse battery staple");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("correct horse battery staple", first), true);
  assert.equal(await verifyPassword("wrong password", first), false);
});

test("creates six-digit verification codes and validates work emails", () => {
  assert.match(verificationCode(), /^\d{6}$/);
  assert.equal(validEmail("finance@example.com"), true);
  assert.equal(validEmail("not-an-email"), false);
});

test("accepts the configured public origin when a reverse proxy changes the request host", () => {
  const previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = "https://abn-guard.wiseway.ai";
  try {
    const proxiedRequest = new Request("https://abn-guard-v2.percival-0ae.workers.dev/api/auth/email/register", {
      headers: { Origin: "https://abn-guard.wiseway.ai" },
    });
    const rejectedRequest = new Request("https://abn-guard-v2.percival-0ae.workers.dev/api/auth/email/register", {
      headers: { Origin: "https://attacker.example" },
    });
    assert.equal(sameOriginRequest(proxiedRequest), true);
    assert.equal(sameOriginRequest(rejectedRequest), false);
  } finally {
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
  }
});

test("keeps email registration and verification on the server", async () => {
  const [page, registerRoute, verifyRoute, googleCredentialRoute, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/email/register/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/email/verify/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/google/credential/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle-pg/0000_initial.sql", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Create account with email/);
  assert.match(page, /Verify email & continue/);
  assert.match(registerRoute, /sendVerificationEmail/);
  assert.match(verifyRoute, /createSessionCookie/);
  assert.match(googleCredentialRoute, /sameOriginRequest/);
  assert.match(migration, /create table email_registrations/i);
  assert.doesNotMatch(page, /RESEND_API_KEY|password_hash|code_hash/);
});
