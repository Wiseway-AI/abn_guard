import { database, publicWorkspace } from "../../../server/database";
import { recordRouteError } from "../../../server/monitoring";
import { planForPriceId } from "../../../server/plans";
import { sessionFromRequest } from "../../../server/session";
import { stripeGet } from "../../../server/stripe";

type StripeObject = Record<string, unknown>;

function nested(value: unknown, ...path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as StripeObject)[key];
  }
  return current;
}

function stringAt(value: unknown, ...path: string[]) {
  const result = nested(value, ...path);
  return typeof result === "string" ? result : "";
}

export async function POST(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });
  try {
    const body = await request.json() as { checkoutSessionId?: unknown };
    const checkoutSessionId = typeof body.checkoutSessionId === "string" ? body.checkoutSessionId.trim() : "";
    if (!checkoutSessionId.startsWith("cs_")) return Response.json({ error: "Invalid Stripe Checkout session." }, { status: 400 });

    const checkout = await stripeGet(`checkout/sessions/${encodeURIComponent(checkoutSessionId)}`, new URLSearchParams({ "expand[]": "subscription" }));
    const workspaceId = stringAt(checkout, "metadata", "workspace_id");
    const customerId = typeof checkout.customer === "string" ? checkout.customer : stringAt(checkout, "customer", "id");
    if (workspaceId !== session.workspace.id || !customerId || (session.user.stripe_customer_id && customerId !== session.user.stripe_customer_id)) {
      return Response.json({ error: "This Stripe Checkout session does not belong to your workspace." }, { status: 403 });
    }
    if (checkout.status !== "complete") return Response.json({ error: "Stripe Checkout has not completed yet." }, { status: 409 });

    const subscription = checkout.subscription && typeof checkout.subscription === "object"
      ? checkout.subscription as StripeObject
      : await stripeGet(`subscriptions/${encodeURIComponent(String(checkout.subscription ?? ""))}`);
    const subscriptionId = typeof subscription.id === "string" ? subscription.id : "";
    const status = typeof subscription.status === "string" ? subscription.status : "unknown";
    const priceId = stringAt(subscription, "items", "data", "0", "price", "id");
    const periodEndValue = nested(subscription, "items", "data", "0", "current_period_end");
    const periodEnd = typeof periodEndValue === "number" ? periodEndValue : null;
    const plan = status === "active" || status === "trialing" ? planForPriceId(priceId) : "free";
    if (!subscriptionId || plan === "free") return Response.json({ error: "Stripe did not return an active Starter subscription." }, { status: 409 });

    const db = await database();
    if (!session.user.stripe_customer_id) {
      await db.prepare("UPDATE users SET stripe_customer_id = ?, updated_at = ? WHERE id = ? AND stripe_customer_id IS NULL")
        .bind(customerId, new Date().toISOString(), session.user.id).run();
    }
    await db.prepare("UPDATE workspaces SET plan = ?, subscription_status = ?, stripe_subscription_id = ?, stripe_price_id = ?, current_period_end = ?, updated_at = ? WHERE id = ?")
      .bind(plan, status, subscriptionId, priceId, periodEnd, new Date().toISOString(), session.workspace.id).run();
    const updatedWorkspace = { ...session.workspace, plan, subscription_status: status, stripe_subscription_id: subscriptionId, stripe_price_id: priceId, current_period_end: periodEnd };
    return Response.json({ workspace: publicWorkspace(updatedWorkspace, 0) });
  } catch (error) {
    await recordRouteError(request, "stripe_sync_error", error);
    return Response.json({ error: error instanceof Error ? error.message : "Stripe subscription could not be confirmed." }, { status: 400 });
  }
}
