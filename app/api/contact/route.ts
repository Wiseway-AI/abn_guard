const DEFAULT_CONTACT_EMAIL = "percival@wiseway.ai";

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { companyName?: string; email?: string; website?: string };
    const companyName = clean(body.companyName, 120);
    const email = clean(body.email, 180).toLowerCase();
    const website = clean(body.website, 200);

    // Honeypot submissions are acknowledged without forwarding them.
    if (website) return Response.json({ ok: true });
    if (!companyName) return Response.json({ error: "Enter your company name." }, { status: 400 });
    if (!validEmail(email)) return Response.json({ error: "Enter a valid work email." }, { status: 400 });

    const contactEmail = clean(process.env.CONTACT_TO_EMAIL, 180) || DEFAULT_CONTACT_EMAIL;
    const response = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(contactEmail)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        company: companyName,
        email,
        _replyto: email,
        _subject: `ABN Guard free trial request — ${companyName}`,
        _template: "table",
        _captcha: "false",
        _url: new URL(request.url).origin,
        source: "ABN Guard landing page",
        submitted_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) throw new Error("Email service rejected the request.");
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Your request could not be sent. Please try again." }, { status: 502 });
  }
}
