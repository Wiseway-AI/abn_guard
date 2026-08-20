import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../app/api/abn/route.ts";

test("rejects anonymous ABN lookups before contacting the official service", async () => {
  const response = await POST(new Request("http://localhost/api/abn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ abn: "53004085616" }),
  }));
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /sign in/i);
});
