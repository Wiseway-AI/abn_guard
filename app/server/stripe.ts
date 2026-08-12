export async function stripeRequest(path: string, body: URLSearchParams) {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Stripe is not configured.");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const error = result.error as { message?: string } | undefined;
    throw new Error(error?.message || "Stripe request failed.");
  }
  return result;
}

export async function stripeGet(path: string, query = new URLSearchParams()) {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Stripe is not configured.");
  const suffix = query.size ? `?${query.toString()}` : "";
  const response = await fetch(`https://api.stripe.com/v1/${path}${suffix}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const error = result.error as { message?: string } | undefined;
    throw new Error(error?.message || "Stripe request failed.");
  }
  return result;
}

export async function verifyStripeWebhook(payload: string, header: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  const parts = Object.fromEntries(header.split(",").map((item) => item.split("=", 2) as [string, string]));
  const timestamp = Number(parts.t);
  const received = parts.v1 ?? "";
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  const expected = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (expected.length !== received.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ received.charCodeAt(index);
  return difference === 0;
}
