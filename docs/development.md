# Development guide

## Choose the correct baseline

The Node.js/PostgreSQL application baseline lives on `main`, which does not deploy. For normal feature development, create a feature branch from `main`, open a pull request to `staging` and verify it in QA. A change intended for production uses a separate pull request from the same feature branch and references the QA evidence. Reconcile any intentional environment divergence before merging.

## Prerequisites

- Node.js 22.13 or newer
- npm from the checked-in `package-lock.json`
- PostgreSQL 16 or newer
- Docker when testing the production image

## Local setup

```bash
git switch main
git pull --ff-only
git switch -c feature/<name>
cp .env.example .env.local
npm ci
npm run db:migrate
npm run dev
```

Open `http://localhost:3001`. `GET /api/health` should return a successful response after the database is reachable.

Create an empty local database before running migrations. A typical local URL is:

```text
postgres://postgres:postgres@localhost:5432/abn_guard
```

The migration command takes a PostgreSQL advisory lock, records checksums and fails if an already-applied migration was modified. Generate a new migration after changing `db/schema.ts`:

```bash
npm run db:generate
npm run db:migrate
```

Never edit an applied migration. Add a new migration instead.

## Configuration groups

Copy names from `.env.example`; do not copy shared environment values into source control.

| Capability | Variables |
|---|---|
| Core | `APP_URL`, `DATABASE_URL`, `SESSION_SECRET` |
| ABR lookup | `ABN_LOOKUP_GUID` |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_KEYLESS_DISABLED` |
| Email | `RESEND_API_KEY`, `AUTH_FROM_EMAIL`, `CONTACT_TO_EMAIL` |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_STARTER_PRICE_ID`, `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` |
| Optional VLM | `VLM_API_URL`, `VLM_MODEL`, `VLM_API_KEY` |

`NEXT_PUBLIC_*` values are embedded into the browser bundle at build time. Changing one requires a new image; changing only a server-side secret requires new tasks to be started with the updated secret version.

For local Google OAuth, register:

- JavaScript origin: `http://localhost:3001`
- Redirect URI: `http://localhost:3001/api/auth/google/callback`

If a provider configuration uses port `3008`, either run a matching local proxy/port or update the provider entry. The application itself defaults to port `3001`.

## Validation

Run the same application checks used for environment pull requests:

```bash
npm run lint -- --quiet
npm test
npx tsc --noEmit --pretty false
npm run build
docker build -t abn-guard:local .
```

The Docker image is built as a Next.js standalone server and runs as a non-root user on port `3000`. Public application URL and Clerk publishable key are build arguments in CI.

## Test boundaries

- Use dedicated test/development provider applications locally and in QA.
- Do not point local development at the production database or live Stripe webhook.
- Exercise document parsing with synthetic or approved files; browser-first extraction keeps most file contents client-side.
- Test schema changes against an empty database and a copy with all existing migrations applied.

See [CI/CD](ci-cd.md) before merging and [VLM endpoint](vlm-endpoint.md) for optional scanned-document processing.
