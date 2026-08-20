import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../app/api/contact/route.ts";

function contact(body) {
  return POST(new Request("http://localhost/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

test("validates free-trial contact details before sending", async () => {
  const response = await contact({ companyName: "", email: "not-an-email" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /company name/i);
});

test("forwards a free-trial request to the configured contact email", async () => {
  const previousFetch = globalThis.fetch;
  const previousContact = process.env.CONTACT_TO_EMAIL;
  let forwarded;
  process.env.CONTACT_TO_EMAIL = "percival@wiseway.ai";
  globalThis.fetch = async (url, options) => {
    forwarded = { url: String(url), options };
    return Response.json({ success: true });
  };
  try {
    const response = await contact({ companyName: "Northbank Pty Ltd", email: "finance@northbank.example" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.match(forwarded.url, /formsubmit\.co\/ajax\/percival%40wiseway\.ai$/);
    const payload = JSON.parse(forwarded.options.body);
    assert.equal(payload.Company, "Northbank Pty Ltd");
    assert.equal(payload.Email, "finance@northbank.example");
    assert.equal(payload._replyto, "finance@northbank.example");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousContact === undefined) delete process.env.CONTACT_TO_EMAIL;
    else process.env.CONTACT_TO_EMAIL = previousContact;
  }
});

test("silently ignores honeypot submissions", async () => {
  const previousFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({ success: true });
  };
  try {
    const response = await contact({ companyName: "Bot Co", email: "bot@example.com", website: "https://spam.example" });
    assert.equal(response.status, 200);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
