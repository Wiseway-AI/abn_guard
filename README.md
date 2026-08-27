# ABN Guard

ABN Guard helps teams verify Australian suppliers before payment. It checks ABN and GST status, stores bank-detail records in shared workspaces, monitors changes and supports subscription-based record limits.

## Environments

| Branch | Environment | URL | Deployment |
|---|---|---|---|
| `main` | Canonical, non-deploying branch | — | None |
| `staging` | QA | [qa-abn-guard.wiseway.ai](https://qa-abn-guard.wiseway.ai) | Automatic on push or manual workflow dispatch |
| `production` | Production | [abn-guard.wiseway.ai](https://abn-guard.wiseway.ai) | Automatic on push or manual workflow dispatch |

`main` is the canonical AWS application baseline and does not deploy. The `staging` and `production` branches are independent environment branches; changes intended for both environments should use separate pull requests from the same tested feature branch.

Production is online and Clerk's custom-domain DNS, email records and TLS certificates are verified. QA uses the canonical Clerk application's development instance; production uses its paired production instance.

## What it includes

- ABN and GST lookup through the Australian Business Register API
- browser-first PDF, Word and spreadsheet extraction, with an optional VLM fallback
- Google, Clerk and verified-email authentication
- PostgreSQL-backed personal and shared company workspaces
- free and Starter record quotas with Stripe Checkout, webhooks and Customer Portal
- account deletion, session revocation, feedback and transactional email flows
- containerized Next.js deployment on isolated QA and production ECS Fargate services

## Developer quick start

Start from the canonical baseline:

```bash
git switch main
git pull --ff-only
git switch -c feature/<name>
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
- [Authentication and Clerk integration](docs/auth.md)
- [CI/CD and release flow](docs/ci-cd.md)
- [AWS infrastructure and operations](docs/infrastructure.md)
- [Optional VLM endpoint](docs/vlm-endpoint.md)

PostgreSQL migrations live in `drizzle-pg/` on the deployment branches. The migrator uses a PostgreSQL advisory lock and checks applied migration checksums. The daily maintenance command removes expired operational records and checks public health.
