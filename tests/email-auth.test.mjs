import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { hashPassword, validEmail, verificationCode, verifyPassword } from "../app/server/email-auth.ts";

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

test("keeps email registration and verification on the server", async () => {
  const [page, registerRoute, verifyRoute, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/email/register/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/email/verify/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0001_optimal_miek.sql", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Create account with email/);
  assert.match(page, /Verify email & continue/);
  assert.match(registerRoute, /sendVerificationEmail/);
  assert.match(verifyRoute, /createSessionCookie/);
  assert.match(migration, /CREATE TABLE `email_registrations`/);
  assert.doesNotMatch(page, /RESEND_API_KEY|password_hash|code_hash/);
});
