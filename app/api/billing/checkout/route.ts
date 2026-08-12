import { database } from "../../../server/database";
import { isPlanKey, priceIdForPlan } from "../../../server/plans";
import { absoluteAppUrl, sessionFromRequest } from "../../../server/session";
import { stripeRequest } from "../../../server/stripe";

export async function POST(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in with Google before choosing a paid plan." }, { status: 401 });
  try {
    if (session.workspace.stripe_subscription_id && ["active", "trialing", "past_due"].includes(session.workspace.subscription_status)) {
      return Response.json({ error: "This workspace already has a subscription. Use Manage billing to change plans." }, { status: 409 });
    }
    const body = await request.json() as { plan?: unknown };
    if (!isPlanKey(body.plan) || body.plan === "free") return Response.json({ error: "Choose a paid plan." }, { status: 400 });
    const priceId = priceIdForPlan(body.plan);
    if (!priceId) return Response.json({ error: "This Stripe price has not been configured yet." }, { status: 503 });
    let customerId = session.user.stripe_customer_id ?? "";
    if (!customerId) {
      const customer = await stripeRequest("customers", new URLSearchParams({ email: session.user.email, name: session.user.name, "metadata[user_id]": session.user.id, "metadata[workspace_id]": session.workspace.id }));
      customerId = String(customer.id ?? "");
      if (!customerId) throw new Error("Stripe customer could not be created.");
      const db = await database();
      await db.prepare("UPDATE users SET stripe_customer_id = ?, updated_at = ? WHERE id = ?").bind(customerId, new Date().toISOString(), session.user.id).run();
    }
    const appUrl = absoluteAppUrl(request);
    const checkout = await stripeRequest("checkout/sessions", new URLSearchParams({
      mode: "subscription",
      customer: customerId,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: `${appUrl}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/?billing=cancelled`,
      allow_promotion_codes: "true",
      "subscription_data[metadata][workspace_id]": session.workspace.id,
      "metadata[workspace_id]": session.workspace.id,
      "metadata[plan]": body.plan,
    }));
    return Response.json({ url: checkout.url });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Checkout could not be started." }, { status: 400 });
  }
}
