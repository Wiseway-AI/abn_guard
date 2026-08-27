# ABN Guard documentation

These guides describe the canonical containerized AWS application on `main` and its `staging` and `production` deployment branches.

| Guide | Audience | Covers |
|---|---|---|
| [Development](development.md) | Application developers | Local PostgreSQL setup, environment variables, migrations, tests and containers |
| [Authentication](auth.md) | Developers and operators | Clerk topology, Google/email flows, credentials, domains, rotation and verification |
| [CI/CD](ci-cd.md) | Developers and release operators | Branch behavior, PR checks, deployment, rollback and verification |
| [Infrastructure](infrastructure.md) | Infrastructure and operations | AWS resources, Terraform ownership, secrets, monitoring and runbooks |
| [VLM endpoint](vlm-endpoint.md) | Document-processing developers | Optional OpenAI-compatible fallback for scanned or unclear files |

The default `main` branch is the non-deploying canonical baseline. The environment branches may diverge intentionally, so always confirm the target branch before a release.

Never put credential values in documentation, issues, pull requests or workflow logs. Record only the secret name, owning environment and validation status.
