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
    /Extract and verify ABNs, GST status and supplier registration details from contracts/i,
  );
  assert.match(html, /<div class="app-loading">Loading ABN Guard…<\/div>/i);
});

test("keeps the ABN Lookup GUID on the server", async () => {
  const [route, page, exampleEnv] = await Promise.all([
    readFile(new URL("../app/api/abn/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(route, /process\.env\.ABN_LOOKUP_GUID/);
  assert.match(exampleEnv, /^ABN_LOOKUP_GUID=\s*$/m);
  assert.doesNotMatch(page, /process\.env\.ABN_LOOKUP_GUID/);
});
