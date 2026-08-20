import assert from "node:assert/strict";
import test from "node:test";

import { classifyAbnRoles, selectAbnsForVerification } from "../app/abn-role.ts";

test("selects the supplier ABN and excludes the Bill To customer", () => {
  const analysis = classifyAbnRoles(`
    Tax Invoice
    Bill To
    E CUBIC PTY LTD
    ABN Terms Created from Due Date
    83 693 352 055 Net 14 Sales Order

    Payment Advice
    Account Name: One Stop Warehouse Pty Ltd
    BSB: 062-161 Account No: 1052 6698
    One Stop Warehouse Pty Ltd ABN: 46 161 849 323
  `, ["83693352055", "46161849323"]);

  assert.deepEqual(analysis.selectedPayeeAbns, ["46161849323"]);
  assert.equal(analysis.candidates.find((item) => item.abn === "83693352055")?.role, "payer");
  assert.equal(analysis.requiresReview, false);
});

test("always treats the workspace company ABN as the payer", () => {
  const analysis = classifyAbnRoles("Customer ABN 83 693 352 055\nSupplier ABN 46 161 849 323", ["83693352055", "46161849323"], "83693352055");
  assert.equal(analysis.candidates.find((item) => item.abn === "83693352055")?.role, "payer");
  assert.deepEqual(analysis.selectedPayeeAbns, ["46161849323"]);
});

test("requires manual review when two ABNs have no clear roles", () => {
  const analysis = classifyAbnRoles("ABN 11 111 111 111\nABN 22 222 222 222", ["11111111111", "22222222222"]);
  assert.equal(analysis.requiresReview, true);
  assert.deepEqual(analysis.selectedPayeeAbns, []);
});

test("skips the workspace ABN and verifies only the selected counterparty", () => {
  const selection = selectAbnsForVerification(
    ["83693352055", "43669580401"],
    ["43669580401"],
    "83 693 352 055",
  );

  assert.deepEqual(selection.skippedOwnAbns, ["83693352055"]);
  assert.deepEqual(selection.verificationAbns, ["43669580401"]);
  assert.deepEqual(selection.selectedPayeeAbns, ["43669580401"]);
});

test("falls back to the sole counterparty when the workspace ABN was incorrectly selected", () => {
  const selection = selectAbnsForVerification(
    ["83693352055", "43669580401"],
    ["83693352055"],
    "83693352055",
  );

  assert.deepEqual(selection.selectedPayeeAbns, ["43669580401"]);
  assert.deepEqual(selection.verificationAbns, ["43669580401"]);
});

test("verifies only a clear payee but keeps unresolved counterparties for review", () => {
  assert.deepEqual(
    selectAbnsForVerification(["11111111111", "22222222222"], ["22222222222"]).verificationAbns,
    ["22222222222"],
  );
  assert.deepEqual(
    selectAbnsForVerification(["11111111111", "22222222222"], []).verificationAbns,
    ["11111111111", "22222222222"],
  );
});
