"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

export default function ContactPage() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("sending");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(data.entries())) });
    const result = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) { setStatus("idle"); setError(result.error || "Your message could not be sent."); return; }
    setStatus("sent");
    event.currentTarget.reset();
  }
  return <main className="public-page"><nav className="public-page-nav"><Link className="public-brand" href="/"><span>A</span>ABN Guard</Link><div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div></nav><div className="public-page-main"><p>CONTACT & SUPPORT</p><h1>Tell us how we can help.</h1><p className="lead">Ask a product question, request a demo, report a data concern or get help with your account. We’ll reply to your work email.</p><section className="public-contact-card"><form onSubmit={submit}><label>Company name<input name="companyName" required maxLength={120} autoComplete="organization" /></label><label>Work email<input name="email" type="email" required maxLength={180} autoComplete="email" /></label><label>How can we help?<textarea name="message" maxLength={2000} placeholder="Product question, support request or feedback…" /></label><label style={{ position: "absolute", left: "-9999px" }}>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>{error && <p className="public-contact-status error">{error}</p>}{status === "sent" && <p className="public-contact-status">Thanks — your message has been received.</p>}<button disabled={status === "sending"}>{status === "sending" ? "Sending…" : "Send message"}</button></form></section></div></main>;
}
