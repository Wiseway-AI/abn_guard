"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

export default function FeedbackDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const [category, setCategory] = useState("feedback");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setStatus("sending");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message, pageUrl: window.location.href }),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Feedback could not be sent.");
      setStatus("sent");
      setMessage("");
    } catch (reason) {
      setStatus("idle");
      setError(reason instanceof Error ? reason.message : "Feedback could not be sent.");
    }
  }

  function close() {
    setError("");
    setStatus("idle");
    onClose();
  }

  return <div className="feedback-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
      <button className="feedback-close" type="button" onClick={close} aria-label="Close feedback form">×</button>
      {status === "sent" ? <div className="feedback-success"><span>✓</span><h2 id="feedback-title">Thank you</h2><p>Your feedback has been saved. We’ll use it to improve ABN Guard.</p><button type="button" className="primary-small" onClick={close}>Done</button></div> : <form onSubmit={submit}>
        <p className="eyebrow">Help improve ABN Guard</p>
        <h2 id="feedback-title">Share feedback or report a problem</h2>
        <p>Your message is linked to your account so we can investigate and follow up.</p>
        <label>What is this about?<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="feedback">Product feedback</option><option value="bug">Something is not working</option><option value="billing">Billing question</option><option value="data">Data or privacy request</option></select></label>
        <label>Message<textarea autoFocus required minLength={5} maxLength={3000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Tell us what happened, what you expected, or what would make the product better…" /></label>
        {error && <p className="feedback-error">{error}</p>}
        <div className="feedback-actions"><Link href="/contact">Contact details</Link><button className="primary-small" type="submit" disabled={status === "sending"}>{status === "sending" ? "Sending…" : "Send feedback"}</button></div>
      </form>}
    </section>
  </div>;
}
