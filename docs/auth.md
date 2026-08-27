# Authentication integration

Last verified: 2026-08-27

ABN Guard supports Clerk as the primary hosted identity provider and retains application-managed Google OAuth, verified-email and managed-account sessions for compatibility. This guide defines the environment mapping, credential ownership and operational checks without recording credential values.

## Current Clerk topology

The Wiseway AI Clerk organization contains one canonical application named `ABN Guard` with Clerk's paired environments:

| ABN Guard environment | Clerk environment | Public identity endpoint | Credential class |
|---|---|---|---|
| Local development | Development | Clerk development domain | Test keys in the developer's `.env.local` |
| QA | Development | `cool-squirrel-7305.clerk.accounts.dev` | Test keys in QA AWS/GitHub configuration |
| Production | Production | `clerk.abn-guard.wiseway.ai` | Live keys in production AWS/GitHub configuration |

Local development and QA currently use the same Clerk development instance. They may use separate application sessions and PostgreSQL databases, but their Clerk users and provider configuration are not isolated. If strict three-way identity isolation becomes necessary, create separate `ABN Guard — Development`, `ABN Guard — QA` and `ABN Guard — Production` Clerk applications and rotate each environment deliberately.

Do not create ad-hoc Clerk applications to solve a key or domain problem. First confirm the application name, environment selector and public key domain in the Clerk dashboard.

## Production domains

Production uses Clerk's custom-domain deployment:

| Purpose | Hostname | DNS target |
|---|---|---|
| Frontend API | `clerk.abn-guard.wiseway.ai` | `frontend-api.clerk.services` |
| Account Portal | `accounts.abn-guard.wiseway.ai` | `accounts.clerk.services` |

Clerk also requires its displayed mail and DKIM CNAME records. Their generated targets belong to the Clerk production instance; copy them from **Developers → Domains** rather than from old messages or screenshots.

The production domain currently reports:

- application DNS 2/2 verified
- email DNS 3/3 verified
- Frontend API and Account Portal certificates issued

Route 53 owns the public records. Clerk owns validation status and certificate issuance. A healthy application `/api/health` response does not prove Clerk TLS or sign-in is healthy; check both.

## Runtime integration

`app/layout.tsx` mounts `ClerkProvider` for the application. `proxy.ts` enables `clerkMiddleware` only when both Clerk keys are present, allowing public pages to remain available during an identity-provider configuration problem.

The Clerk routes are:

- `/sign-in/[[...sign-in]]`
- `/sign-up/[[...sign-up]]`

Server-side session resolution in `app/server/session.ts` checks Clerk first. A verified Clerk email is required before the user is inserted or updated in PostgreSQL. The database stores Clerk's stable user ID in `users.clerk_user_id`; never use an email address as the external identity key.

Account operations are provider-aware:

- session revocation revokes Clerk sessions when the workspace belongs to a Clerk user
- permanent account deletion deletes the Clerk user after application confirmation
- legacy signed sessions remain available during migration and provider outages

## Other authentication paths

Clerk's Google button is configured inside the Clerk application. ABN Guard also contains an application-managed Google OAuth flow under `/api/auth/google/*`, configured with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `SESSION_SECRET`.

The application-managed Google callback URLs are:

- `http://localhost:3001/api/auth/google/callback`
- `https://qa-abn-guard.wiseway.ai/api/auth/google/callback`
- `https://abn-guard.wiseway.ai/api/auth/google/callback`

Verified-email registration and sign-in use `RESEND_API_KEY`, `AUTH_FROM_EMAIL` and `SESSION_SECRET`. These are separate from Clerk's own verification email and custom email DNS records.

Avoid enabling duplicate sign-in choices accidentally. When changing authentication UX, test both the Clerk component and the application-managed fallback routes.

## Configuration ownership

| Setting | Local development | QA | Production |
|---|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `.env.local` | GitHub `staging` environment and QA Secrets Manager | GitHub `production` environment and production Secrets Manager |
| `CLERK_SECRET_KEY` | `.env.local` | QA Secrets Manager | Production Secrets Manager |
| `NEXT_PUBLIC_CLERK_KEYLESS_DISABLED` | `.env.local` or default | Container build/runtime | Container build/runtime |
| Google OAuth values | `.env.local` | QA Secrets Manager | Production Secrets Manager |
| `SESSION_SECRET` | `.env.local` | QA Secrets Manager | Production Secrets Manager |

AWS secret names are:

- `abn-guard/qa/application`
- `abn-guard/prod/application`

The publishable Clerk key is compiled into the Next.js browser bundle. It must be available to GitHub Actions during the image build and must match the `CLERK_SECRET_KEY` injected into ECS. Changing the publishable key requires a new image; changing a server-side secret requires new tasks.

Never print, paste into issues, or commit key values. Report only presence, environment, key class and validation status.

## Local setup

Use a Clerk test-key pair and never use production keys locally:

```text
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<development publishable key>
CLERK_SECRET_KEY=<matching development secret key>
NEXT_PUBLIC_CLERK_KEYLESS_DISABLED=true
APP_URL=http://localhost:3001
```

Start the application with `npm run dev`, then verify `/sign-in` and `/sign-up`. The application defaults to port `3001`; provider settings for a different port must be updated or routed through a matching local proxy.

## Rotation procedure

Rotate one environment at a time:

1. Confirm the Clerk application and environment selector.
2. Generate or reveal the replacement keys in Clerk.
3. Update the matching AWS Secrets Manager secret without logging values.
4. Update the matching GitHub environment's publishable build secret.
5. Deploy a new immutable image to the matching environment.
6. Verify the Clerk domain, `/sign-in`, `/sign-up`, Google, email verification, session persistence, logout, revocation and account deletion.
7. Revoke the old key only after the new deployment passes.

Never update QA and production in one unverified rotation. Never reuse production keys in QA or local development.

## Verification checklist

For each deployed environment:

- `/api/health` returns success
- `/sign-in` displays `Sign in to ABN Guard`
- Google and email controls render without a Clerk development-key warning in production
- the account-portal link uses the expected environment domain
- a new verified user receives an isolated PostgreSQL workspace
- logout clears the provider and application session
- session revocation invalidates active sessions
- account deletion removes application data and the Clerk user
- browser console and CloudWatch logs contain no Clerk key, domain or CSP errors

For production, additionally confirm **Developers → Domains** reports all DNS records verified and both certificates issued.

## Troubleshooting

### Public page works but sign-in does not

Check Clerk domain status, certificate issuance, the publishable-key domain and Content Security Policy. `/api/health` does not call Clerk.

### QA shows a development-mode message

This is expected while QA uses Clerk's development instance. Production must use live keys and the custom domain.

### Clerk loads but server authentication fails

Confirm the publishable and secret keys belong to the same Clerk instance and that the ECS task was restarted after a secret update.

### Google callback fails

Determine whether the user entered through Clerk's Google button or the application-managed Google route. They have separate provider configuration surfaces and should not be debugged as one flow.

### Sign-in is blocked by CSP

Keep the development Clerk domain patterns and the production Frontend API/Account Portal hosts in `next.config.ts`. Validate any CSP change in both QA and production before release.
