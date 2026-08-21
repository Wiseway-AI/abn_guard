import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { filesWithoutAbn, groupVerificationChecksByFile, mapWithConcurrency, MAX_INVOICE_BATCH_FILES, selectInvoiceBatchFiles } from "../app/invoice-batch.ts";

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

test("keeps one result per file and stacks multiple ABN checks inside it", () => {
  const groups = groupVerificationChecksByFile([
    { id: "a-1", fileIds: ["invoice-a"], abn: "11111111111" },
    { id: "a-2", fileIds: ["invoice-a"], abn: "22222222222" },
    { id: "b-1", fileIds: ["invoice-b"], abn: "33333333333" },
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].map((check) => check.id), ["a-1", "a-2"]);
  assert.deepEqual(groups[1].map((check) => check.id), ["b-1"]);
});

test("honours extraction concurrency while preserving file order", async () => {
  let active = 0;
  let maximumActive = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, value % 2 ? 4 : 1));
    active -= 1;
    return value * 10;
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(results, [10, 20, 30, 40]);
});

test("requires missing-ABN invoices to be reviewed without saving them to Records", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /No valid ABN was found in this file/);
  assert.match(page, /check\.missingAbn && !check\.reviewed/);
  assert.match(page, /!check\.missingAbn && checkIsVerified\(check\)/);
  assert.match(page, /<MissingAbnVerification/);
});

test("keeps every uploaded invoice represented and verifies every ABN returned for it", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /documents\.flatMap\(detectedEntitiesForDocument\)/);
  assert.match(page, /verificationSelection\.verificationAbns\.map\(\(abn\)/);
  assert.match(page, /groupVerificationChecksByFile\(latestChecks\)/);
  assert.match(page, /activeResultChecks\.map\(\(check\)/);
  assert.match(page, /mapWithConcurrency\(selection\.accepted, 2/);
  assert.match(page, /setDocuments\(\(previous\) => \[\.\.\.previous, parsedDocument\]\)/);
  assert.match(page, /verificationCheckForDetected\(detected, progressiveBatchId, \[parsedDocument\]\)/);
  assert.match(page, /Processing invoices… \$\{documents\.length\} complete/);
  assert.match(page, /check\.contractAddress \|\| check\.contractLocation/);
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
