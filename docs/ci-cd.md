# CI/CD guide

## Branch mapping

| Target branch | Environment | ECS cluster/service | Public URL |
|---|---|---|---|
| `staging` | QA | `qa-abn-guard` | `https://qa-abn-guard.wiseway.ai` |
| `production` | Production | `prod-abn-guard` | `https://abn-guard.wiseway.ai` |
| `main` | None | None | None |

`staging` and `production` are independent deployment branches. A feature intended for both is validated in QA first, then applied to production through a separate change that references the QA evidence.

At the time of writing, the repository has no mandatory PR reviewer, branch protection or production environment reviewer. Authorized users can push or manually dispatch a deployment. The workflow checks and health gates still apply, but they are not a substitute for review. Check current GitHub repository and environment settings before assuming guardrails exist.

## Pull-request checks

`.github/workflows/ci.yml` runs for pull requests targeting `staging` or `production`:

1. Install exactly from `package-lock.json` using Node.js 22.13.
2. Run lint, tests, TypeScript checking and the production build.
3. Confirm that PostgreSQL migration files exist and reject obvious destructive SQL.
4. Build an `linux/amd64` review image.
5. Scan it with Trivy for high and critical vulnerabilities and upload SARIF.

The review image architecture is deliberately independent of the release image. Releases are built natively as ARM64 for Fargate.

## Deployment workflow

`.github/workflows/deploy.yml` runs on a push to an environment branch or by manual dispatch from that branch:

1. Select the GitHub environment, public URL, ECS cluster and desired count from the branch.
2. Assume an environment-restricted AWS role through GitHub OIDC. No long-lived AWS access key is stored in GitHub.
3. Validate the Clerk publishable build secret.
4. Build and push `abn-guard:<commit-sha>` to ECR unless that immutable tag already exists.
5. Copy the current ECS task definition and replace only its application image.
6. Register the next task definition.
7. Run `node scripts/migrate.mjs` as a one-off Fargate task and require exit code zero.
8. Update the ECS service, wait for stability and call `/api/health`.
9. If a later deployment step fails, restore the previous task definition and desired count.

Deployments are serialized per branch. A new push does not cancel a release already in progress.

## GitHub environment configuration

Each GitHub environment needs:

- `AWS_DEPLOY_ROLE_ARN`: environment-specific OIDC role created by Terraform
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`: environment-specific build secret

Runtime secrets are not copied into GitHub. They remain in the QA or production AWS Secrets Manager secret and are injected by the ECS task definition.

## Release procedure

For QA:

1. Merge or push the tested change to `staging`.
2. Wait for the deploy workflow, migration task and ECS health gate.
3. Verify sign-in, workspace reads/writes, ABN lookup, quota behavior, email and Stripe test flows relevant to the change.
4. Record the workflow URL and QA evidence for the production change.

For production:

1. Confirm QA evidence and that production provider configuration is ready.
2. Merge or push the production change.
3. Wait for service stability and public health.
4. Run focused production smoke tests without creating unintended live charges or messages.

Manual recovery runs must select the exact environment branch. Because image tags are immutable, rerunning the same commit reuses its existing image.

## Failure and rollback

- Migration failure stops before the ECS service update.
- Rollout or health failure restores the previous task definition and desired count.
- Inspect the migration task and `/ecs/<environment>-abn-guard` CloudWatch logs before retrying.
- Application rollback does not reverse a database migration. Schema changes must remain backward-compatible with the previous application revision.
- The legacy Cloudflare Worker is an origin-level rollback option during its retention window; it is not controlled by the GitHub deployment workflow.

See [Infrastructure](infrastructure.md) for AWS ownership and diagnostic commands.
