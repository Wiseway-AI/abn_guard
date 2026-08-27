# Infrastructure guide

ABN Guard runs in AWS account `170388059982`, region `ap-southeast-2`. Terraform and Terragrunt source is maintained in [`Wiseway-AI/wise-infra-terraform`](https://github.com/Wiseway-AI/wise-infra-terraform/tree/codex/abn-guard-aws/abn-guard).

## Request path

```text
Browser -> Route 53 -> CloudFront + WAF -> HTTPS ALB -> private ECS Fargate tasks -> private RDS PostgreSQL
```

CloudFront uses a dedicated regional origin hostname so edge TLS and origin TLS can be managed separately.

## Environment inventory

| Component | QA | Production |
|---|---|---|
| Public hostname | `qa-abn-guard.wiseway.ai` | `abn-guard.wiseway.ai` |
| Origin hostname | `origin.qa-abn-guard.wiseway.ai` | `origin.abn-guard.wiseway.ai` |
| ECS cluster/service | `qa-abn-guard` | `prod-abn-guard` |
| Tasks | 1 | 2 desired, autoscaling to 4 |
| Compute | ARM64 Fargate, 0.5 vCPU / 1 GB | ARM64 Fargate, 0.5 vCPU / 1 GB per task |
| Database | PostgreSQL 16, `db.t4g.micro`, single-AZ, 20 GB | PostgreSQL 16, `db.t4g.small`, Multi-AZ, 20-100 GB |
| Backups | 7 days | 14 days with deletion protection |
| Log retention | 14 days | 90 days |
| CloudFront ID | `E3O37KKGUMJFX5` | `E2PA7Y6WBMXZR3` |
| VPC | `vpc-0addd020116b7ca16` | `vpc-068e34e24c764bd7c` |

Tasks run in private subnets behind public ALBs. Database ingress is limited to the corresponding ECS task security group. Production uses an environment KMS key and Multi-AZ database placement.

## Terraform ownership

The infrastructure repository has three state-owning entrypoints:

- `abn-guard/shared`: ECR, enhanced scanning, image lifecycle and GitHub OIDC deployment roles
- `abn-guard/qa`: the complete QA application stack
- `abn-guard/prod`: the complete production application stack, including adopted edge records

Their remote state keys are derived from those paths. Run Terragrunt only from the owning folder. Application workflows may register newer task-definition revisions; Terraform owns the service shape and GitHub Actions owns application image releases.

## Secrets and configuration

QA and production have separate application secrets and separate RDS-managed database credentials in AWS Secrets Manager. The current ECS task definition injects Clerk, Google, Resend/email, session signing, Stripe and ABR lookup values. Optional VLM and contact-recipient settings require a corresponding task-definition allowlist change before they are available in AWS. Secret values must never appear in Terraform inputs or repository files.

Public browser values such as `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` are also required at image build time in the matching GitHub environment. Keep the build value and AWS runtime value aligned.

The Google OAuth callback set should include:

- `http://localhost:3001/api/auth/google/callback`
- `https://qa-abn-guard.wiseway.ai/api/auth/google/callback`
- `https://abn-guard.wiseway.ai/api/auth/google/callback`

Production Clerk custom-domain TLS validation is a known external blocker for production sign-in. The public site and AWS health endpoint can be healthy while Clerk's custom domain is not; validate both separately.

## Monitoring and maintenance

Each environment has CloudWatch log groups, a dashboard and alarms for:

- ALB 5xx responses
- insufficient healthy ECS tasks
- database connections
- application errors
- Stripe failures

EventBridge runs `npm run maintenance` as a one-off ECS task daily at 02:15 UTC. It removes expired operational records and verifies public health.

## Operational checks

Use AWS CLI profile `wiseway`:

```powershell
aws sts get-caller-identity --profile wiseway --region ap-southeast-2
aws ecs describe-services --cluster qa-abn-guard --services qa-abn-guard --profile wiseway --region ap-southeast-2
aws ecs describe-services --cluster prod-abn-guard --services prod-abn-guard --profile wiseway --region ap-southeast-2
Invoke-RestMethod https://qa-abn-guard.wiseway.ai/api/health
Invoke-RestMethod https://abn-guard.wiseway.ai/api/health
```

For infrastructure changes:

```powershell
Set-Location D:\Projects\Wiseway\Repositories\wise-infra-terraform\abn-guard\qa
terragrunt validate
terragrunt plan
```

Repeat from `abn-guard/prod` for production. Stop if the plan proposes replacement/destruction of adopted edge resources, database replacement, or an empty lookup for existing networking.

## Recovery boundaries

- The deployment workflow can restore the previous ECS task definition, but it cannot reverse database migrations.
- Production database deletion protection must remain enabled; snapshot before destructive database work.
- Production CloudFront, WAF, ACM and DNS were adopted. Verify state before importing or changing them.
- The legacy Worker origin `abn-guard-v2.percival-0ae.workers.dev` is retained only for the agreed rollback window.
