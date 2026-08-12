import { database } from "../../../server/database";
import { planForPriceId } from "../../../server/plans";
import { verifyStripeWebhook } from "../../../server/stripe";

type StripeEvent = { type?: string; data?: { object?: Record<string, unknown> } };

function nestedString(value: unknown, ...path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : "";
}

export async function POST(request: Request) {
  const payload = await request.text();
  if (!(await verifyStripeWebhook(payload, request.headers.get("Stripe-Signature") ?? ""))) return Response.json({ error: "Invalid Stripe signature." }, { status: 400 });
  try {
    const event = JSON.parse(payload) as StripeEvent;
    const object = event.data?.object ?? {};
    if (event.type === "checkout.session.completed") {
      const workspaceId = nestedString(object, "metadata", "workspace_id");
      const customerId = typeof object.customer === "string" ? object.customer : "";
      const subscriptionId = typeof object.subscription === "string" ? object.subscription : "";
      const db = await database();
      if (workspaceId) await db.prepare("UPDATE workspaces SET stripe_subscription_id = ?, subscription_status = 'processing', updated_at = ? WHERE id = ?").bind(subscriptionId || null, new Date().toISOString(), workspaceId).run();
      if (workspaceId && customerId) await db.prepare("UPDATE users SET stripe_customer_id = ?, updated_at = ? WHERE id = (SELECT owner_user_id FROM workspaces WHERE id = ?)").bind(customerId, new Date().toISOString(), workspaceId).run();
    }
    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscriptionId = typeof object.id === "string" ? object.id : "";
      const workspaceId = nestedString(object, "metadata", "workspace_id");
      const status = typeof object.status === "string" ? object.status : "unknown";
      const priceId = nestedString(object, "items", "data", "0", "price", "id");
      const active = status === "active" || status === "trialing";
      const plan = active ? planForPriceId(priceId) : "free";
      const periodEnd = typeof object.current_period_end === "number" ? object.current_period_end : null;
      const query = workspaceId ? "UPDATE workspaces SET plan = ?, subscription_status = ?, stripe_subscription_id = ?, stripe_price_id = ?, current_period_end = ?, updated_at = ? WHERE id = ?" : "UPDATE workspaces SET plan = ?, subscription_status = ?, stripe_subscription_id = ?, stripe_price_id = ?, current_period_end = ?, updated_at = ? WHERE stripe_subscription_id = ?";
      const db = await database();
      await db.prepare(query).bind(plan, status, subscriptionId || null, priceId || null, periodEnd, new Date().toISOString(), workspaceId || subscriptionId).run();
    }
    return Response.json({ received: true });
  } catch {
    return Response.json({ error: "Stripe event could not be processed." }, { status: 400 });
  }
}
