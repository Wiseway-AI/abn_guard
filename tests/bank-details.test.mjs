import assert from "node:assert/strict";
import test from "node:test";

import { bankDetailsKey, bankDetailsMatch, extractBankDetails, formatBsb } from "../app/bank-details.ts";

test("extracts labelled Australian bank details from invoice text", () => {
  assert.deepEqual(
    extractBankDetails(`
      PAYMENT DETAILS
      Account name: Example Energy Solutions Pty Ltd
      Bank name: Example Bank
      BSB: 123-456
      Account number: 9876 54321
    `),
    {
      accountName: "Example Energy Solutions Pty Ltd",
      bankName: "Example Bank",
      bsb: "123456",
      accountNumber: "987654321",
    },
  );
});

test("supports values placed on the line after their labels", () => {
  const details = extractBankDetails(`
    Acc Name
    Example Services Pty Ltd
    BSB Number
    062-000
    Acc No.
    12345678
  `);
  assert.equal(details?.accountName, "Example Services Pty Ltd");
  assert.equal(details?.bsb, "062000");
  assert.equal(details?.accountNumber, "12345678");
});

test("compares the BSB and account number while tolerating account-name formatting", () => {
  const saved = { accountName: "EXAMPLE SERVICES PTY LTD", bankName: "", bsb: "062000", accountNumber: "12345678" };
  const matching = { accountName: "Example Services", bankName: "Example Bank", bsb: "062-000", accountNumber: "12 345 678" };
  const changed = { ...matching, accountNumber: "87654321" };
  assert.equal(bankDetailsMatch(saved, matching), true);
  assert.equal(bankDetailsMatch(saved, changed), false);
  assert.equal(bankDetailsKey(saved), bankDetailsKey(matching));
  assert.equal(formatBsb(saved.bsb), "062-000");
});

test("does not create a bank record without a BSB or account number", () => {
  assert.equal(extractBankDetails("Account name: Example Services Pty Ltd"), null);
});

test("extracts a bare Account label beside the BSB and ignores adjacent terms text", () => {
  assert.deepEqual(
    extractBankDetails(`
      PAYMENT DETAILS TERMS
      Bank Commonwealth Bank (CBA) Payment due within 7 days of issue.
      Account Name Dream & Community document is a valid tax invoice for GST purposes.
      BSB 063 109 Account 1311 1956 Prices in AUD.
      Reference INV140720268589
    `),
    {
      accountName: "Dream & Community",
      bankName: "Commonwealth Bank (CBA)",
      bsb: "063109",
      accountNumber: "13111956",
    },
  );
});

test("does not treat an unrelated bare account number as payment details", () => {
  const details = extractBankDetails("BSB 063 109\nUnrelated text" + " x".repeat(180) + "\nAccount 1311 1956");
  assert.equal(details?.accountNumber, "");
});
