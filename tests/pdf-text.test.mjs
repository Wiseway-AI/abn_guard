import assert from "node:assert/strict";
import test from "node:test";

import { pdfTextRows } from "../app/pdf-text.ts";

test("removes diagonal watermark text without breaking a footer ABN", () => {
  const text = pdfTextRows([
    { str: "One Stop Warehouse Pty Ltd", transform: [9, 0, 0, 9, 196, 37.5] },
    { str: "E CUBIC PTY LTD", transform: [7.35, 6.17, -6.17, 7.35, 278, 38] },
    { str: "ABN: 46 161 849 323", transform: [9, 0, 0, 9, 324, 37.5] },
    { str: "Offices: PERTH | ADELAIDE", transform: [7.2, 0, 0, 7.2, 196, 28.3] },
  ]);

  assert.match(text, /One Stop Warehouse Pty Ltd ABN: 46 161 849 323/);
  assert.doesNotMatch(text, /E CUBIC/);
});

test("keeps normal payment advice and bank-detail rows", () => {
  const text = pdfTextRows([
    { str: "Payment Advice:", transform: [9, 0, 0, 9, 38, 180] },
    { str: "Acct Name: One Stop Warehouse Pty Ltd BSB: 062-161 A/C No: 1052 6698", transform: [9, 0, 0, 9, 38, 163] },
  ]);

  assert.match(text, /Payment Advice:/);
  assert.match(text, /BSB: 062-161 A\/C No: 1052 6698/);
});
