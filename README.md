# ABN Guard

ABN Guard helps teams verify Australian suppliers before payment. It checks ABN and GST status, stores bank-detail records in shared workspaces, monitors changes and supports subscription-based record limits.

## Environments

| Branch | Environment | URL | Deployment |
|---|---|---|---|
| `main` | Canonical, non-deploying branch | — | None |
| `staging` | QA | [qa-abn-guard.wiseway.ai](https://qa-abn-guard.wiseway.ai) | Automatic on push or manual workflow dispatch |
| `production` | Production | [abn-guard.wiseway.ai](https://abn-guard.wiseway.ai) | Automatic on push or manual workflow dispatch |

The AWS runtime source currently lives on the independent `staging` and `production` branches. `main` still contains parts of the earlier Vinext/Cloudflare baseline and must not be treated as runtime-equivalent until the branches are reconciled. Start AWS application work from the environment branch you intend to change.

Production is online, but Clerk custom-domain TLS validation is still pending. Public pages and `/api/health` remain available; production sign-in should not be considered accepted until Clerk reports its custom domain healthy.

## What it includes

- ABN and GST lookup through the Australian Business Register API
- browser-first PDF, Word and spreadsheet extraction, with an optional VLM fallback
- Google, Clerk and verified-email authentication
- PostgreSQL-backed personal and shared company workspaces
- free and Starter record quotas with Stripe Checkout, webhooks and Customer Portal
- account deletion, session revocation, feedback and transactional email flows
- containerized Next.js deployment on isolated QA and production ECS Fargate services

## Developer quick start

Use the deployable staging baseline:

```bash
git switch staging
cp .env.example .env.local
npm ci
npm run db:migrate
npm run dev
```

Requirements are Node.js 22.13 or newer and PostgreSQL 16 or newer. Configure `DATABASE_URL`, `SESSION_SECRET` and the authentication values needed for the flow you are testing. The application listens on `http://localhost:3001`; the container listens on port `3000`.

Before opening a pull request:

```bash
npm run lint
npm test
npx tsc --noEmit --pretty false
npm run build
docker build -t abn-guard .
```

Do not commit `.env.local` or any Google, Clerk, Resend, Stripe, ABR, database or VLM secret.

## Architecture

The deployable application is Next.js 16 on Node.js with Drizzle ORM and PostgreSQL. GitHub Actions builds immutable ARM64 images, pushes them to Amazon ECR, runs migrations as one-off ECS tasks and rolls out environment-specific Fargate services. CloudFront and WAF serve public traffic through encrypted ALB origins.

Infrastructure is maintained in [`Wiseway-AI/wise-infra-terraform`](https://github.com/Wiseway-AI/wise-infra-terraform/tree/codex/abn-guard-aws/abn-guard).

## Documentation

- [Documentation index](docs/README.md)
- [Local development and configuration](docs/development.md)
- [CI/CD and release flow](docs/ci-cd.md)
- [AWS infrastructure and operations](docs/infrastructure.md)
- [Optional VLM endpoint](docs/vlm-endpoint.md)

PostgreSQL migrations live in `drizzle-pg/` on the deployment branches. The migrator uses a PostgreSQL advisory lock and checks applied migration checksums. The daily maintenance command removes expired operational records and checks public health.
