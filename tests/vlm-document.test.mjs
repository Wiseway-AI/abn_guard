import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assessPdfText,
  isValidAustralianAbn,
  mergeVlmExtractions,
  normalizeVlmExtraction,
  selectVlmPageNumbers,
  vlmExtractionToText,
} from "../app/vlm-document.ts";
import { QWEN3_VL_ABN_SYSTEM_PROMPT } from "../app/vlm-prompt.ts";

test("assesses embedded PDF text so browser extraction remains a safe fallback", () => {
  const scanned = assessPdfText(["", "  "]);
  assert.equal(scanned.needsVlm, true);
  assert.match(scanned.reasons.join(" "), /little or no embedded text/);

  const digital = assessPdfText([
    "Tax Invoice\nSupplier: B.O.W PROJECTS AUSTRALIA PTY LTD\nABN 43 669 580 401\nPayment details and ordinary invoice text ".repeat(3),
  ]);
  assert.equal(isValidAustralianAbn("43 669 580 401"), true);
  assert.equal(digital.needsVlm, false);
  assert.deepEqual(digital.validAbns, ["43669580401"]);
});

test("processes every page rather than sampling away middle pages", () => {
  assert.deepEqual(selectVlmPageNumbers(3), [1, 2, 3]);
  assert.deepEqual(selectVlmPageNumbers(12), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test("normalizes VLM output and rejects hallucinated invalid ABNs", () => {
  const extraction = normalizeVlmExtraction({
    document_type: "invoice",
    entities: [
      { abn: "43 669 580 401", entity_name: "B.O.W Projects Australia Pty Ltd", address: "12 Example Street, Melbourne VIC 3000", confidence: 1.4, page: 1 },
      { abn: "11 111 111 111", entityName: "Hallucinated", address: "Unknown", confidence: 0.99, page: 1 },
    ],
    bank_details: { account_name: "B.O.W Projects Australia Pty Ltd", bsb: "063-109", account_number: "1311 1956", confidence: 0.91, page: 1 },
    confidence: 0.95,
  });

  assert.equal(extraction.entities.length, 1);
  assert.equal(extraction.entities[0].abn, "43669580401");
  assert.equal(extraction.entities[0].address, "12 Example Street, Melbourne VIC 3000");
  assert.equal(extraction.entities[0].confidence, 1);
  assert.deepEqual(extraction.bankDetails && { bsb: extraction.bankDetails.bsb, accountNumber: extraction.bankDetails.accountNumber }, { bsb: "063109", accountNumber: "13111956" });
  assert.match(vlmExtractionToText(extraction), /Invoice Entity[\s\S]*ABN: 43669580401[\s\S]*VIC 3000[\s\S]*BSB: 063109/);
});

test("merges page batches by ABN and keeps the strongest associated details", () => {
  const first = normalizeVlmExtraction({ entities: [{ abn: "43 669 580 401", entityName: "B.O.W Projects", address: "", page: 1, confidence: 0.7 }], confidence: 0.8 });
  const second = normalizeVlmExtraction({ entities: [{ abn: "43 669 580 401", entityName: "B.O.W Projects Australia Pty Ltd", address: "Melbourne VIC 3000", page: 5, confidence: 0.95 }], confidence: 0.9 });
  const merged = mergeVlmExtractions([first, second]);

  assert.equal(merged.entities.length, 1);
  assert.equal(merged.entities[0].entityName, "B.O.W Projects Australia Pty Ltd");
  assert.equal(merged.entities[0].address, "Melbourne VIC 3000");
  assert.equal(merged.entities[0].page, 5);
});

test("uses a Qwen3-VL prompt that extracts all ABNs without payer or payee classification", () => {
  assert.match(QWEN3_VL_ABN_SYSTEM_PROMPT, /find every distinct Australian Business Number/);
  assert.match(QWEN3_VL_ABN_SYSTEM_PROMPT, /Do not classify entities as payer, payee/);
  assert.match(QWEN3_VL_ABN_SYSTEM_PROMPT, /"address"/);
  assert.doesNotMatch(QWEN3_VL_ABN_SYSTEM_PROMPT, /"role"/);
});

test("keeps the active VLM implementation server-side without exposing credentials", async () => {
  const [page, route, privacy, envExample] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/vlm/extract/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(page, /assessPdfText/);
  assert.match(page, /readContract\(file, true\)/);
  assert.doesNotMatch(page, /if \(!assessment\.needsVlm\) return \{ text: localText, processing: "browser"/);
  assert.match(page, /toDataURL\("image\/jpeg", 0\.72\)/);
  assert.doesNotMatch(page, /Private VLM fallback|VLM fallback awaiting connection/);
  assert.doesNotMatch(page, /process\.env\.VLM_API_KEY|process\.env\.VLM_API_URL/);
  assert.match(route, /sessionFromRequest\(request\)/);
  assert.match(route, /QWEN3_VL_ABN_SYSTEM_PROMPT/);
  assert.match(route, /message\.content \|\| message\.reasoning/);
  assert.match(route, /reasoning_effort: "none"/);
  assert.match(route, /response_format: \{ type: "json_object" \}/);
  assert.match(route, /max_tokens: 1600/);
  assert.match(route, /process\.env\.VLM_API_URL/);
  assert.match(route, /ngrok-skip-browser-warning/);
  assert.match(route, /consumeRateLimit\("vlm_extract"/);
  assert.match(privacy, /vision-language model endpoint/);
  assert.match(envExample, /VLM_API_URL=/);
  assert.match(envExample, /VLM_API_KEY=/);
});
