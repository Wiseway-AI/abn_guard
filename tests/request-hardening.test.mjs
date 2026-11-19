import assert from "node:assert/strict";
import test from "node:test";

import { clientAddress } from "../app/server/monitoring.ts";
import { BodyTooLargeError, readJsonBody } from "../app/server/request-body.ts";

const request = (headers) => new Request("https://abn-guard.test/api/auth/email/signin", { headers });

test("derives the client address from proxy-appended values, not client-supplied ones", () => {
  assert.equal(clientAddress(request({ "CloudFront-Viewer-Address": "203.0.113.7:51234" })), "203.0.113.7");
  assert.equal(clientAddress(request({ "CloudFront-Viewer-Address": "2001:db8::1:443" })), "2001:db8::1");
  // A forged leading X-Forwarded-For entry is ignored: CloudFront appends the viewer, the ALB appends the edge.
  assert.equal(clientAddress(request({ "X-Forwarded-For": "1.2.3.4, 198.51.100.20, 130.176.0.1" })), "198.51.100.20");
  assert.equal(clientAddress(request({ "CF-Connecting-IP": "9.9.9.9", "X-Forwarded-For": "198.51.100.20, 130.176.0.1" })), "198.51.100.20");
  assert.equal(clientAddress(request({ "X-Forwarded-For": "198.51.100.20" })), "198.51.100.20");
  assert.equal(clientAddress(request({})), "unknown");
});

test("parses JSON bodies within the limit and rejects oversized ones", async () => {
  const small = new Request("https://abn-guard.test/api/workspace", { method: "PUT", body: JSON.stringify({ state: { register: [] } }) });
  assert.deepEqual(await readJsonBody(small, 1_000), { state: { register: [] } });

  const declared = new Request("https://abn-guard.test/api/workspace", { method: "PUT", body: "{}", headers: { "Content-Length": "5000" } });
  await assert.rejects(readJsonBody(declared, 1_000), BodyTooLargeError);

  const streamed = new Request("https://abn-guard.test/api/workspace", { method: "PUT", body: JSON.stringify({ data: "x".repeat(5_000) }) });
  await assert.rejects(readJsonBody(streamed, 1_000), BodyTooLargeError);
});
