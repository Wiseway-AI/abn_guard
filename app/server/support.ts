import { database } from "./database.ts";

const DEFAULT_CONTACT_EMAIL = "percival@wiseway.ai";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export async function storeContactRequest(input: { companyName: string; email: string; message: string }) {
  const db = await database();
  await db.prepare(`INSERT INTO contact_requests (id, company_name, email, message, status, created_at)
    VALUES (?, ?, ?, ?, 'new', ?)`).bind(crypto.randomUUID(), input.companyName, input.email, input.message, new Date().toISOString()).run();
}

export async function storeFeedback(input: { actorId: string; workspaceId: string | null; email: string; category: string; message: string; pageUrl: string }) {
  const db = await database();
  await db.prepare(`INSERT INTO feedback (id, actor_id, workspace_id, email, category, message, page_url, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?)`).bind(crypto.randomUUID(), input.actorId, input.workspaceId, input.email, input.category, input.message, input.pageUrl, new Date().toISOString()).run();
}

export async function sendSupportEmail(input: { subject: string; replyTo?: string; fields: Array<[string, string]> }) {
  const to = process.env.CONTACT_TO_EMAIL?.trim() || DEFAULT_CONTACT_EMAIL;
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.AUTH_FROM_EMAIL?.trim();
  if (apiKey && from) {
    const rows = input.fields.map(([label, value]) => `<tr><td style="padding:8px 12px;color:#65748b;border-bottom:1px solid #e6ebf2">${escapeHtml(label)}</td><td style="padding:8px 12px;color:#071b33;border-bottom:1px solid #e6ebf2;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`).join("");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: input.replyTo || undefined,
        subject: input.subject,
        html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;padding:28px"><h1 style="font-size:22px;color:#1746d1">ABN Guard</h1><table style="width:100%;border-collapse:collapse">${rows}</table></div>`,
        text: input.fields.map(([label, value]) => `${label}: ${value}`).join("\n\n"),
      }),
    });
    if (!response.ok) throw new Error("Resend rejected the support notification.");
    return;
  }

  const response = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(to)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(Object.fromEntries([
      ...input.fields,
      ["_replyto", input.replyTo || ""],
      ["_subject", input.subject],
      ["_template", "table"],
      ["_captcha", "false"],
    ])),
  });
  if (!response.ok) throw new Error("Email service rejected the support notification.");
}
