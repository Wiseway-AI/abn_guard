import { sameOriginRequest } from "../../server/email-auth.ts";
import { recordRouteError } from "../../server/monitoring.ts";
import { sendSupportEmail, storeContactRequest } from "../../server/support.ts";

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  try {
    if (!sameOriginRequest(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    const body = (await request.json()) as { companyName?: string; email?: string; message?: string; website?: string };
    const companyName = clean(body.companyName, 120);
    const email = clean(body.email, 180).toLowerCase();
    const website = clean(body.website, 200);
    const message = clean(body.message, 2_000);

    // Honeypot submissions are acknowledged without forwarding them.
    if (website) return Response.json({ ok: true });
    if (!companyName) return Response.json({ error: "Enter your company name." }, { status: 400 });
    if (!validEmail(email)) return Response.json({ error: "Enter a valid work email." }, { status: 400 });

    await Promise.allSettled([storeContactRequest({ companyName, email, message })]);
    await sendSupportEmail({
      subject: `ABN Guard enquiry — ${companyName}`,
      replyTo: email,
      fields: [["Company", companyName], ["Email", email], ["Message", message || "Free trial request"], ["Source", new URL(request.url).origin], ["Submitted", new Date().toISOString()]],
    });
    return Response.json({ ok: true });
  } catch (error) {
    await recordRouteError(request, "contact_delivery_error", error);
    return Response.json({ error: "Your request could not be sent. Please try again." }, { status: 502 });
  }
}
