import assert from "node:assert/strict";
import test from "node:test";

import { accountFileKey, accountStorageKey } from "../app/account-scope.ts";
import { POST } from "../app/api/account-auth/route.ts";

function signIn(username, password) {
  return POST(new Request("http://localhost/api/account-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  }));
}

test("authenticates managed beta accounts without exposing another workspace", async () => {
  const previousBow = process.env.BOW_PASSWORD;
  const previousGcgf = process.env.GCGF_PASSWORD;
  const previousJiaqi = process.env.JIAQI_PASSWORD;
  const previousSessionSecret = process.env.SESSION_SECRET;
  process.env.BOW_PASSWORD = "test-bow-password";
  process.env.GCGF_PASSWORD = "test-gcgf-password";
  process.env.JIAQI_PASSWORD = "test-jiaqi-password";
  process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough";
  try {
    const bowResponse = await signIn("bow", "test-bow-password");
    assert.equal(bowResponse.status, 200);
    assert.deepEqual((await bowResponse.json()).account, {
      id: "managed-bow",
      username: "bow",
      companyName: "BOW",
      setupComplete: false,
      unlimitedAbns: true,
    });
    assert.match(bowResponse.headers.get("set-cookie") ?? "", /^abn_guard_managed_session=/);

    const jiaqiResponse = await signIn("jiaqi", "test-jiaqi-password");
    assert.equal(jiaqiResponse.status, 200);
    assert.deepEqual((await jiaqiResponse.json()).account, {
      id: "managed-jiaqi",
      username: "jiaqi",
      companyName: "Jiaqi",
      setupComplete: false,
      unlimitedAbns: true,
    });

    const crossAccountResponse = await signIn("gcgf", "test-bow-password");
    assert.equal(crossAccountResponse.status, 401);
  } finally {
    if (previousBow === undefined) delete process.env.BOW_PASSWORD;
    else process.env.BOW_PASSWORD = previousBow;
    if (previousGcgf === undefined) delete process.env.GCGF_PASSWORD;
    else process.env.GCGF_PASSWORD = previousGcgf;
    if (previousJiaqi === undefined) delete process.env.JIAQI_PASSWORD;
    else process.env.JIAQI_PASSWORD = previousJiaqi;
    if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSessionSecret;
  }
});

test("uses separate storage and file namespaces for every managed account", () => {
  assert.notEqual(accountStorageKey("managed-bow", "register"), accountStorageKey("managed-gcgf", "register"));
  assert.notEqual(accountFileKey("managed-bow", "invoice-1"), accountFileKey("managed-gcgf", "invoice-1"));
  assert.notEqual(accountStorageKey("managed-jiaqi", "register"), accountStorageKey("managed-gcgf", "register"));
});
