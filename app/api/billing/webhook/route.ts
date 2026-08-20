import { database } from "../../../server/database";
import { recordMonitoringEvent, recordRouteError } from "../../../server/monitoring";
import { planForPriceId } from "../../../server/plans";
import { verifyStripeWebhook } from "../../../server/stripe";

type StripeEvent = { id?: string; type?: string; created?: number; data?: { object?: Record<string, unknown> } };

function nestedString(value: unknown, ...path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : "";
}

function nestedNumber(value: unknown, ...path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "number" ? current : null;
}

export async function POST(request: Request) {
  const payload = await request.text();
  if (!(await verifyStripeWebhook(payload, request.headers.get("Stripe-Signature") ?? ""))) return Response.json({ error: "Invalid Stripe signature." }, { status: 400 });
  try {
    const event = JSON.parse(payload) as StripeEvent;
    const eventId = typeof event.id === "string" ? event.id : "";
    const eventCreated = typeof event.created === "number" ? event.created : 0;
    if (!eventId || !event.type) return Response.json({ error: "Stripe event is incomplete." }, { status: 400 });
    const db = await database();
    const existing = await db.prepare("SELECT status FROM stripe_events WHERE id = ?").bind(eventId).first<{ status: string }>();
    if (existing?.status === "processed") return Response.json({ received: true, duplicate: true });
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO stripe_events (id, event_type, event_created, status, created_at)
      VALUES (?, ?, ?, 'processing', ?)
      ON CONFLICT(id) DO UPDATE SET status = 'processing', error = NULL`)
      .bind(eventId, event.type, eventCreated, now).run();
    const object = event.data?.object ?? {};
    if (event.type === "checkout.session.completed") {
      const workspaceId = nestedString(object, "metadata", "workspace_id");
      const customerId = typeof object.customer === "string" ? object.customer : "";
      const subscriptionId = typeof object.subscription === "string" ? object.subscription : "";
      if (workspaceId) await db.prepare("UPDATE workspaces SET stripe_subscription_id = ?, subscription_status = 'processing', stripe_event_created = ?, updated_at = ? WHERE id = ? AND stripe_event_created <= ?").bind(subscriptionId || null, eventCreated, now, workspaceId, eventCreated).run();
      if (workspaceId && customerId) await db.prepare("UPDATE users SET stripe_customer_id = ?, updated_at = ? WHERE id = (SELECT owner_user_id FROM workspaces WHERE id = ?)").bind(customerId, new Date().toISOString(), workspaceId).run();
    }
    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscriptionId = typeof object.id === "string" ? object.id : "";
      const workspaceId = nestedString(object, "metadata", "workspace_id");
      const status = typeof object.status === "string" ? object.status : "unknown";
      const priceId = nestedString(object, "items", "data", "0", "price", "id");
      const active = status === "active" || status === "trialing";
      const plan = active ? planForPriceId(priceId) : "free";
      const itemPeriodEnd = nestedNumber(object, "items", "data", "0", "current_period_end");
      const periodEnd = itemPeriodEnd && itemPeriodEnd > 0
        ? itemPeriodEnd
        : typeof object.current_period_end === "number" ? object.current_period_end : null;
      const query = workspaceId
        ? "UPDATE workspaces SET plan = ?, subscription_status = ?, stripe_subscription_id = ?, stripe_price_id = ?, current_period_end = ?, stripe_event_created = ?, updated_at = ? WHERE id = ? AND stripe_event_created <= ?"
        : "UPDATE workspaces SET plan = ?, subscription_status = ?, stripe_subscription_id = ?, stripe_price_id = ?, current_period_end = ?, stripe_event_created = ?, updated_at = ? WHERE stripe_subscription_id = ? AND stripe_event_created <= ?";
      await db.prepare(query).bind(plan, status, subscriptionId || null, priceId || null, periodEnd, eventCreated, now, workspaceId || subscriptionId, eventCreated).run();
    }
    if (event.type === "invoice.payment_failed") {
      const customerId = typeof object.customer === "string" ? object.customer : "";
      const subscriptionId = typeof object.subscription === "string" ? object.subscription : nestedString(object, "parent", "subscription_details", "subscription");
      const amountDue = typeof object.amount_due === "number" ? object.amount_due : 0;
      const currency = typeof object.currency === "string" ? object.currency.toUpperCase() : "AUD";
      await recordMonitoringEvent({
        category: "stripe_payment_failed",
        severity: "critical",
        route: new URL(request.url).pathname,
        message: "Stripe reported a failed subscription payment.",
        metadata: { customerId, subscriptionId, amountDue, currency, eventId },
        notify: true,
      });
    }
    await db.prepare("UPDATE stripe_events SET status = 'processed', processed_at = ?, error = NULL WHERE id = ?").bind(new Date().toISOString(), eventId).run();
    return Response.json({ received: true });
  } catch (error) {
    try {
      const event = JSON.parse(payload) as StripeEvent;
      if (event.id) {
        const db = await database();
        await db.prepare("UPDATE stripe_events SET status = 'failed', error = ? WHERE id = ?").bind(error instanceof Error ? error.message.slice(0, 500) : "Unknown processing error", event.id).run();
      }
    } catch {
      // Stripe will retry the original event after the non-2xx response.
    }
    await recordRouteError(request, "stripe_webhook_error", error);
    return Response.json({ error: "Stripe event could not be processed." }, { status: 400 });
  }
}
