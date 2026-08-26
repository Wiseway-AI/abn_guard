"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { accountEnding, demoCertificate } from "./demo-certificate";
import styles from "./badge-demo.module.css";

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

export default function BadgeDemoPage() {
  const [companyName, setCompanyName] = useState(demoCertificate.companyName);
  const [invoiceReference, setInvoiceReference] = useState(demoCertificate.invoiceReference);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [verificationUrl, setVerificationUrl] = useState("/verify/demo");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const url = `${window.location.origin}/verify/demo`;
    setVerificationUrl(url);
    void QRCode.toDataURL(url, {
      width: 280,
      margin: 1,
      color: { dark: "#163f33", light: "#ffffff" },
      errorCorrectionLevel: "M",
    }).then(setQrDataUrl);
  }, []);

  const accountLastFour = useMemo(() => accountEnding(demoCertificate.accountNumber), []);

  async function copyLink() {
    await navigator.clipboard.writeText(verificationUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function downloadBadge() {
    const canvas = document.createElement("canvas");
    canvas.width = 1500;
    canvas.height = 540;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.fillStyle = "#f4f7f4";
    context.fillRect(0, 0, canvas.width, canvas.height);
    roundedRect(context, 24, 24, 1452, 492, 36);
    context.fillStyle = "#ffffff";
    context.fill();
    context.strokeStyle = "#bed8cc";
    context.lineWidth = 3;
    context.stroke();

    roundedRect(context, 56, 56, 170, 170, 32);
    context.fillStyle = "#1f624c";
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = "bold 96px Arial";
    context.textAlign = "center";
    context.fillText("✓", 141, 174);

    context.textAlign = "left";
    context.fillStyle = "#1f624c";
    context.font = "bold 25px Arial";
    context.fillText("GUARDIAN VERIFIED", 266, 92);
    context.fillStyle = "#15201c";
    context.font = "bold 42px Arial";
    context.fillText(companyName.slice(0, 42), 266, 145);
    context.fillStyle = "#63706a";
    context.font = "24px Arial";
    context.fillText(`ABN ${demoCertificate.abn}  •  ${demoCertificate.abnStatus}  •  GST ${demoCertificate.gstStatus}`, 266, 190);

    context.strokeStyle = "#e0e7e3";
    context.beginPath();
    context.moveTo(56, 258);
    context.lineTo(1160, 258);
    context.stroke();

    context.fillStyle = "#68766f";
    context.font = "bold 18px Arial";
    context.fillText("PAYMENT DETAILS", 56, 310);
    context.fillStyle = "#15201c";
    context.font = "bold 30px Arial";
    context.fillText(`BSB ${demoCertificate.bsb}  •  Account ending ${accountLastFour}`, 56, 356);
    context.fillStyle = "#68766f";
    context.font = "22px Arial";
    context.fillText(`${demoCertificate.level}  •  Invoice ${invoiceReference || "—"}`, 56, 400);
    context.fillText(`Certificate ${demoCertificate.id}  •  Expires ${demoCertificate.expiresAt}`, 56, 444);

    if (qrDataUrl) {
      const qrImage = new Image();
      qrImage.src = qrDataUrl;
      await qrImage.decode();
      context.drawImage(qrImage, 1210, 82, 214, 214);
    }
    context.fillStyle = "#1f624c";
    context.font = "bold 22px Arial";
    context.textAlign = "center";
    context.fillText("CHECK BEFORE YOU PAY", 1317, 342);
    context.fillStyle = "#68766f";
    context.font = "18px Arial";
    context.fillText("Independent verification by ABN Guard", 1317, 378);

    const link = document.createElement("a");
    link.download = `guardian-verified-${invoiceReference || demoCertificate.id}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="/"><span>A</span><strong>ABN Guard</strong></a>
        <a className={styles.backLink} href="/">Back to workspace</a>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>DIGITAL PAYMENT IDENTITY · DEMO</p>
          <h1>Give every invoice a<br /><em>verifiable identity.</em></h1>
        </div>
        <p>Generate a clickable Guardian Verified badge that binds a supplier ABN, a saved payment record and an invoice reference to one live verification page.</p>
      </section>

      <section className={styles.workspace}>
        <aside className={styles.controls}>
          <div className={styles.sectionHeading}><span>1</span><div><h2>Badge details</h2><p>Preview the supplier-facing setup.</p></div></div>
          <label>Registered entity<input value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></label>
          <div className={styles.readOnlyGrid}>
            <label>ABN<input value={demoCertificate.abn} readOnly /></label>
            <label>BSB<input value={demoCertificate.bsb} readOnly /></label>
          </div>
          <label>Invoice reference<input value={invoiceReference} onChange={(event) => setInvoiceReference(event.target.value)} /></label>

          <div className={styles.levelCard}>
            <div><span className={styles.radioOn}>●</span><p><strong>Supplier confirmed</strong><small>Available with the current ABN Guard review workflow</small></p></div>
            <div className={styles.disabledLevel}><span>○</span><p><strong>Bank-linked verified</strong><small>Requires CDR or secure bank-link integration</small></p><em>Coming later</em></div>
          </div>

          <div className={styles.privacyNote}><span>◉</span><p><strong>Privacy-safe by default</strong><small>The badge shows only the last four account digits. The payer enters the full details to check for a match.</small></p></div>
        </aside>

        <section className={styles.previewPanel}>
          <div className={styles.sectionHeading}><span>2</span><div><h2>Live badge preview</h2><p>Clicking the badge opens the verification page.</p></div></div>

          <a className={styles.badge} href={verificationUrl} target="_blank" rel="noreferrer" aria-label="Open Guardian Verified demo certificate">
            <div className={styles.badgeTop}>
              <span className={styles.shield}>✓</span>
              <div className={styles.badgeIdentity}><small>GUARDIAN VERIFIED</small><strong>{companyName || "Entity name"}</strong><p>ABN {demoCertificate.abn} <i>Active</i></p></div>
              {qrDataUrl && <img src={qrDataUrl} alt="QR code to open the verification page" />}
            </div>
            <div className={styles.badgeFacts}>
              <div><small>PAYMENT DETAILS</small><strong>BSB {demoCertificate.bsb} · Account ending {accountLastFour}</strong></div>
              <div><small>VERIFICATION LEVEL</small><strong>{demoCertificate.level}</strong></div>
              <div><small>INVOICE</small><strong>{invoiceReference || "—"}</strong></div>
            </div>
            <div className={styles.badgeFoot}><span>Certificate {demoCertificate.id} · Expires {demoCertificate.expiresAt}</span><strong>Check before you pay →</strong></div>
          </a>

          <div className={styles.actions}>
            <button className={styles.primaryAction} type="button" onClick={() => void downloadBadge()}>Download PNG</button>
            <button type="button" onClick={() => void copyLink()}>{copied ? "Link copied ✓" : "Copy verification link"}</button>
            <a href={verificationUrl} target="_blank" rel="noreferrer">Open public page ↗</a>
          </div>

          <p className={styles.disclaimer}>Independent verification by ABN Guard. ABN data is sourced from ABN Lookup. This demo is not affiliated with or endorsed by the Australian Government.</p>
        </section>
      </section>

      <section className={styles.flow}>
        <p className={styles.eyebrow}>HOW THE LIVE PRODUCT WOULD WORK</p>
        <div><article><span>01</span><h3>Confirm the supplier record</h3><p>The supplier selects an ABN and an approved bank record inside ABN Guard.</p></article><article><span>02</span><h3>Issue a signed badge</h3><p>ABN Guard creates a unique certificate for the invoice and its payment-detail version.</p></article><article><span>03</span><h3>Customer checks before paying</h3><p>The payer scans or clicks, enters the invoice details and receives Match or No match.</p></article></div>
      </section>
    </main>
  );
}
