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
  process.env.BOW_PASSWORD = "test-bow-password";
  process.env.GCGF_PASSWORD = "test-gcgf-password";
  try {
    const bowResponse = await signIn("bow", "test-bow-password");
    assert.equal(bowResponse.status, 200);
    assert.deepEqual((await bowResponse.json()).account, {
      id: "managed-bow",
      username: "bow",
      companyName: "BOW",
      setupComplete: false,
    });

    const crossAccountResponse = await signIn("gcgf", "test-bow-password");
    assert.equal(crossAccountResponse.status, 401);
  } finally {
    if (previousBow === undefined) delete process.env.BOW_PASSWORD;
    else process.env.BOW_PASSWORD = previousBow;
    if (previousGcgf === undefined) delete process.env.GCGF_PASSWORD;
    else process.env.GCGF_PASSWORD = previousGcgf;
  }
});

test("uses separate storage and file namespaces for every managed account", () => {
  assert.notEqual(accountStorageKey("managed-bow", "register"), accountStorageKey("managed-gcgf", "register"));
  assert.notEqual(accountFileKey("managed-bow", "invoice-1"), accountFileKey("managed-gcgf", "invoice-1"));
});
