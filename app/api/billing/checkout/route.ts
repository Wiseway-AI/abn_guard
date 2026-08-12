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
    const appUrl = absoluteAppUrl(request);
    const checkoutParams = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: `${appUrl}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/?billing=cancelled`,
      allow_promotion_codes: "true",
      "subscription_data[metadata][workspace_id]": session.workspace.id,
      "metadata[workspace_id]": session.workspace.id,
      "metadata[plan]": body.plan,
    });
    if (session.user.stripe_customer_id) checkoutParams.set("customer", session.user.stripe_customer_id);
    else checkoutParams.set("customer_email", session.user.email);
    const checkout = await stripeRequest("checkout/sessions", checkoutParams);
    return Response.json({ url: checkout.url });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Checkout could not be started." }, { status: 400 });
  }
}
