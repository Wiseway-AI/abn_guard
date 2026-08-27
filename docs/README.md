# ABN Guard documentation

These guides describe the containerized AWS application on the `staging` and `production` branches.

| Guide | Audience | Covers |
|---|---|---|
| [Development](development.md) | Application developers | Local PostgreSQL setup, environment variables, migrations, tests and containers |
| [CI/CD](ci-cd.md) | Developers and release operators | Branch behavior, PR checks, deployment, rollback and verification |
| [Infrastructure](infrastructure.md) | Infrastructure and operations | AWS resources, Terraform ownership, secrets, monitoring and runbooks |
| [VLM endpoint](vlm-endpoint.md) | Document-processing developers | Optional OpenAI-compatible fallback for scanned or unclear files |

The default `main` branch is non-deploying and is not yet runtime-equivalent to the environment branches. When commands depend on the AWS runtime, switch to `staging` or `production` first.

Never put credential values in documentation, issues, pull requests or workflow logs. Record only the secret name, owning environment and validation status.
