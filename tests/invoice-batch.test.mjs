import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { filesWithoutAbn, MAX_INVOICE_BATCH_FILES, selectInvoiceBatchFiles } from "../app/invoice-batch.ts";

test("limits each invoice verification batch to ten files", () => {
  const incoming = Array.from({ length: 7 }, (_, index) => `invoice-${index + 1}.pdf`);
  const selection = selectInvoiceBatchFiles(6, incoming);

  assert.equal(MAX_INVOICE_BATCH_FILES, 10);
  assert.deepEqual(selection.accepted, incoming.slice(0, 4));
  assert.equal(selection.rejectedCount, 3);
  assert.deepEqual(selectInvoiceBatchFiles(10, incoming), { accepted: [], rejectedCount: 7 });
});

test("identifies every uploaded file without a detected ABN", () => {
  const documents = [
    { name: "supplier-a.pdf", abns: ["43669580401"] },
    { name: "missing-one.pdf", abns: [] },
    { name: "supplier-b.pdf", abns: ["46161849323"] },
    { name: "missing-two.pdf", abns: [] },
  ];

  assert.deepEqual(filesWithoutAbn(documents).map((document) => document.name), ["missing-one.pdf", "missing-two.pdf"]);
});

test("requires missing-ABN invoices to be reviewed without saving them to Records", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /No valid ABN was found in this file/);
  assert.match(page, /check\.missingAbn && !check\.reviewed/);
  assert.match(page, /!check\.missingAbn && checkIsVerified\(check\)/);
  assert.match(page, /<MissingAbnVerification/);
});

test("creates one verification result per uploaded invoice instead of merging by ABN", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /return documents\.flatMap\(\(document\)/);
  assert.match(page, /fileIds: \[document\.id\]/);
  assert.match(page, /fileNames: \[document\.name\]/);
  assert.doesNotMatch(page, /map\.get\(abn\)|map\.set\(abn/);
  assert.match(page, /lookupFailed: true/);
});

test("does not label an invoice ABN as a customer or ignored result", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(page, /Customer \/ ignored|Suggested payee|Use as payee/);
  assert.match(page, /Invoice ABN/);
});
