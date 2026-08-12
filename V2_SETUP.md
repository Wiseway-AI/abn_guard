# ABN Guard V2 setup

V2 runs separately from the current production version on the `codex/google-stripe-v2` branch.

## Plans

| Plan | Monthly price | Record limit |
| --- | ---: | ---: |
| Free trial | A$0 | 30 ABN / bank-detail records |
| Starter | A$9.90 | 500 ABN / bank-detail records |

The server enforces these limits when the workspace is saved, including records created by contract checks and Excel imports.

## Google sign-in

Create a Web application in Google Cloud Console and add these authorised JavaScript origins:

- Local: `http://localhost:3001`
- V2 production: `https://YOUR_V2_DOMAIN`

Set `GOOGLE_CLIENT_ID`, `SESSION_SECRET`, and `APP_URL` as server variables. `SESSION_SECRET` should be a long random value and must remain private. The Google Client ID is safe to expose to the browser; no Google Client Secret is required for this Identity Services flow.

## Stripe

Create one monthly recurring price in AUD:

- Starter: A$9.90 per month
Set its Price ID in `STRIPE_STARTER_PRICE_ID`. Set `STRIPE_SECRET_KEY`, then create a webhook endpoint at:

`https://YOUR_V2_DOMAIN/api/billing/webhook`

Subscribe it to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Save the webhook signing secret as `STRIPE_WEBHOOK_SECRET`. Enable subscription changes and cancellations in the Stripe Customer Portal settings.

## Database

V2 requires a Cloudflare D1 database bound as `DB`. Apply the migration in `drizzle/0000_unique_changeling.sql` before enabling Google sign-in.

The database stores users, isolated workspaces, subscription state, and workspace records. Original uploaded documents remain in the user's browser in this version.
