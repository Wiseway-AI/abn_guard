import { absoluteAppUrl, sessionFromRequest } from "../../../server/session";
import { stripeRequest } from "../../../server/stripe";

export async function POST(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!session.user.stripe_customer_id) return Response.json({ error: "No Stripe billing account exists for this workspace." }, { status: 400 });
  try {
    const portal = await stripeRequest("billing_portal/sessions", new URLSearchParams({ customer: session.user.stripe_customer_id, return_url: `${absoluteAppUrl(request)}/` }));
    return Response.json({ url: portal.url });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Billing portal could not be opened." }, { status: 400 });
  }
}
