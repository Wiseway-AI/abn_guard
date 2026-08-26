# ABN Guard

ABN Guard is a Next.js application for verifying Australian supplier ABNs, GST status, and bank-detail records. It supports Google, Clerk, and verified-email authentication, PostgreSQL-backed company workspaces, Stripe subscriptions, and browser-first document processing.

## Local development

Requirements:

- Node.js 22.13 or newer
- PostgreSQL 16 or newer

Copy `.env.example` to `.env.local`, configure `DATABASE_URL` and the required authentication values, then run:

```sh
npm ci
npm run db:migrate
npm run dev
```

The application listens on `http://localhost:3001`. The health endpoint is `/api/health`.

## Verification

```sh
npm run lint
npm test
npm run build
docker build -t abn-guard .
```

## Deployment branches

- `staging` deploys to `https://qa-abn-guard.wiseway.ai`.
- `production` deploys to `https://abn-guard.wiseway.ai` after production-environment approval.
- `main` does not deploy.

Environment branches are independent. A change intended for both environments uses separate pull requests and the production pull request must reference successful QA verification.

## Database and maintenance

PostgreSQL migrations live in `drizzle-pg/` and are applied with `npm run db:migrate`. The migrator serializes concurrent runs with a PostgreSQL advisory lock and rejects modified applied migrations.

The scheduled maintenance command is `npm run maintenance`. AWS EventBridge runs it as a one-off ECS task to clean expired operational records and verify public health.

## Runtime configuration

Secrets belong in AWS Secrets Manager and are injected into ECS tasks. Non-secret environment settings are defined by Terraform. Never commit Stripe, Google, Clerk, Resend, ABN Lookup, database, or VLM credentials.
