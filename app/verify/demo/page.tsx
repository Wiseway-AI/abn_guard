"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { accountEnding, demoCertificate, normalisePaymentValue } from "../../badge-demo/demo-certificate";
import styles from "./verify-demo.module.css";

type MatchState = "idle" | "match" | "no-match";

export default function PublicVerificationDemo() {
  const [bsb, setBsb] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [result, setResult] = useState<MatchState>("idle");

  function verifyPaymentDetails(event: FormEvent) {
    event.preventDefault();
    const isMatch = normalisePaymentValue(bsb) === normalisePaymentValue(demoCertificate.bsb)
      && normalisePaymentValue(accountNumber) === normalisePaymentValue(demoCertificate.accountNumber);
    setResult(isMatch ? "match" : "no-match");
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}><Link href="/"><span>A</span><strong>ABN Guard</strong></Link><p>Independent supplier verification</p></header>
      <section className={styles.shell}>
        <div className={styles.statusBanner}><span>✓</span><div><small>CERTIFICATE STATUS</small><h1>Valid supplier record</h1><p>Last confirmed {demoCertificate.confirmedAt}</p></div><em>{demoCertificate.level}</em></div>

        <section className={styles.identity}>
          <p>GUARDIAN VERIFIED</p>
          <h2>{demoCertificate.companyName}</h2>
          <div><span><small>ABN</small><strong>{demoCertificate.abn}</strong><i>Active</i></span><span><small>GST STATUS</small><strong>{demoCertificate.gstStatus}</strong></span><span><small>MAIN LOCATION</small><strong>{demoCertificate.location}</strong></span></div>
        </section>

        <section className={styles.paymentCard}>
          <div className={styles.paymentHeading}><span>BANK</span><div><h3>Check the payment details</h3><p>Enter the BSB and account number printed on the invoice. ABN Guard will compare them without revealing the saved account.</p></div></div>
          <div className={styles.savedSummary}><span><small>ACCOUNT NAME</small><strong>{demoCertificate.accountName}</strong></span><span><small>SAVED PAYMENT RECORD</small><strong>BSB {demoCertificate.bsb} · Account ending {accountEnding(demoCertificate.accountNumber)}</strong></span></div>
          <form onSubmit={verifyPaymentDetails}>
            <label>BSB<input inputMode="numeric" value={bsb} onChange={(event) => { setBsb(event.target.value); setResult("idle"); }} placeholder="000-000" required /></label>
            <label>Account number<input inputMode="numeric" value={accountNumber} onChange={(event) => { setAccountNumber(event.target.value); setResult("idle"); }} placeholder="Enter the full account number" required /></label>
            <button type="submit">Check payment details</button>
          </form>
          {result === "match" && <div className={`${styles.result} ${styles.match}`}><span>✓</span><p><strong>Payment details match</strong><small>The BSB and account number match the supplier-confirmed record for this ABN.</small></p></div>}
          {result === "no-match" && <div className={`${styles.result} ${styles.noMatch}`}><span>!</span><p><strong>Do not pay these details</strong><small>The information entered does not match this certificate. Contact the supplier using an independently sourced number.</small></p></div>}
        </section>

        <section className={styles.certificateFacts}><div><small>INVOICE REFERENCE</small><strong>{demoCertificate.invoiceReference}</strong></div><div><small>CERTIFICATE ID</small><strong>{demoCertificate.id}</strong></div><div><small>VALID UNTIL</small><strong>{demoCertificate.expiresAt}</strong></div></section>

        <aside className={styles.scope}><strong>What this certificate means</strong><p>This demo confirms that the entered payment details match a record reviewed and confirmed by the supplier in ABN Guard. It does not yet independently confirm bank-account ownership. A future bank-linked verification would require CDR or another secure banking connection.</p></aside>
      </section>
      <footer>ABN information sourced from ABN Lookup · ABN Guard is not affiliated with or endorsed by the Australian Government.</footer>
    </main>
  );
}
