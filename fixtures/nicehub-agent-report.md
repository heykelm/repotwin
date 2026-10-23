# Agent Readiness Report

## Summary
- Repository: nicehub-platform
- Root: `/Users/hmannai/Downloads/nicehub-platform`
- Score: 0/100 (F)
- Primary language: JavaScript
- Frameworks: none
- Monorepo: none
- Package manager: unknown

nicehub-platform needs canonical agent instructions before AI coding agents can work reliably.

## Commands
| Kind | Command |
| --- | --- |
| none |  |

## Agent Docs
- cursor: `.cursor/rules/00-monorepo.mdc`
- cursor: `.cursor/rules/b2b-koi.mdc`
- cursor: `.cursor/rules/backend-api.mdc`
- cursor: `.cursor/rules/backend-db-ops.mdc`
- cursor: `.cursor/rules/frontend-admin.mdc`
- cursor: `.cursor/rules/frontend-driver.mdc`
- cursor: `.cursor/rules/typography-hyphen.mdc`
- codex: `AGENTS.md`
- claude: `CLAUDE.md`

## Findings
| Severity | Rule | Message | File | Fix |
| --- | --- | --- | --- | --- |
| warning | missing-safety-section | .cursor/rules/00-monorepo.mdc does not include safety boundaries. | .cursor/rules/00-monorepo.mdc | Add a short safety section covering destructive commands and secrets. |
| warning | missing-safety-section | .cursor/rules/b2b-koi.mdc does not include safety boundaries. | .cursor/rules/b2b-koi.mdc | Add a short safety section covering destructive commands and secrets. |
| warning | missing-safety-section | .cursor/rules/backend-api.mdc does not include safety boundaries. | .cursor/rules/backend-api.mdc | Add a short safety section covering destructive commands and secrets. |
| warning | missing-safety-section | .cursor/rules/frontend-admin.mdc does not include safety boundaries. | .cursor/rules/frontend-admin.mdc | Add a short safety section covering destructive commands and secrets. |
| warning | missing-safety-section | .cursor/rules/frontend-driver.mdc does not include safety boundaries. | .cursor/rules/frontend-driver.mdc | Add a short safety section covering destructive commands and secrets. |
| warning | missing-safety-section | CLAUDE.md does not include safety boundaries. | CLAUDE.md | Add a short safety section covering destructive commands and secrets. |
| warning | missing-test-command | No test command was detected. | package.json | Add a test script or configure the test command in agent-ready.json. |
| warning | missing-verification-section | .cursor/rules/00-monorepo.mdc does not explain verification. | .cursor/rules/00-monorepo.mdc | Add the expected test, lint, or build commands. |
| warning | missing-verification-section | .cursor/rules/b2b-koi.mdc does not explain verification. | .cursor/rules/b2b-koi.mdc | Add the expected test, lint, or build commands. |
| warning | missing-verification-section | .cursor/rules/backend-db-ops.mdc does not explain verification. | .cursor/rules/backend-db-ops.mdc | Add the expected test, lint, or build commands. |
| warning | missing-verification-section | .cursor/rules/frontend-admin.mdc does not explain verification. | .cursor/rules/frontend-admin.mdc | Add the expected test, lint, or build commands. |
| warning | missing-verification-section | .cursor/rules/frontend-driver.mdc does not explain verification. | .cursor/rules/frontend-driver.mdc | Add the expected test, lint, or build commands. |
| warning | missing-verification-section | .cursor/rules/typography-hyphen.mdc does not explain verification. | .cursor/rules/typography-hyphen.mdc | Add the expected test, lint, or build commands. |
| warning | missing-verification-section | AGENTS.md does not explain verification. | AGENTS.md | Add the expected test, lint, or build commands. |
| warning | missing-verification-section | CLAUDE.md does not explain verification. | CLAUDE.md | Add the expected test, lint, or build commands. |
| warning | stale-path-reference | .cursor/rules/b2b-koi.mdc references missing path "rides.price". | .cursor/rules/b2b-koi.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/backend-api.mdc references missing path "src/middleware/auth.js". | .cursor/rules/backend-api.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/backend-api.mdc references missing path "src/routes/". | .cursor/rules/backend-api.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/backend-api.mdc references missing path "src/services/". | .cursor/rules/backend-api.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/backend-api.mdc references missing path "src/services/payment.js". | .cursor/rules/backend-api.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/backend-api.mdc references missing path "src/services/b2b-providers.service.js". | .cursor/rules/backend-api.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/backend-api.mdc references missing path "rides.price". | .cursor/rules/backend-api.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/backend-db-ops.mdc references missing path "rides.datetime". | .cursor/rules/backend-db-ops.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/backend-db-ops.mdc references missing path "073_b2b_providers_v1.sql". | .cursor/rules/backend-db-ops.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/backend-db-ops.mdc references missing path "backfill-b2b-koi-rides.js". | .cursor/rules/backend-db-ops.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/backend-db-ops.mdc references missing path "mark-b2b-provider-paid.js". | .cursor/rules/backend-db-ops.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/backend-db-ops.mdc references missing path "fix-koi-prices-and-commissions.js". | .cursor/rules/backend-db-ops.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/backend-db-ops.mdc references missing path ".env". | .cursor/rules/backend-db-ops.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/frontend-admin.mdc references missing path "lib/translations.ts". | .cursor/rules/frontend-admin.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/frontend-admin.mdc references missing path "t.admin.*". | .cursor/rules/frontend-admin.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/frontend-admin.mdc references missing path "@/components/entity". | .cursor/rules/frontend-admin.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/frontend-admin.mdc references missing path "app/admin/providers/". | .cursor/rules/frontend-admin.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/frontend-admin.mdc references missing path "rides.price". | .cursor/rules/frontend-admin.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/frontend-admin.mdc references missing path "lib/date-utils.ts". | .cursor/rules/frontend-admin.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/frontend-driver.mdc references missing path "components/driver/AppAgenda.tsx". | .cursor/rules/frontend-driver.mdc | Update or remove the stale path reference. |
| warning | stale-path-reference | .cursor/rules/frontend-driver.mdc references missing path "lib/api.ts". | .cursor/rules/frontend-driver.mdc | Update or remove the stale path reference. |
| info | drift-prone-agent-doc | .cursor/rules/00-monorepo.mdc duplicates agent guidance without referencing AGENTS.md. | .cursor/rules/00-monorepo.mdc | Replace most content with a short pointer to AGENTS.md. |
| info | drift-prone-agent-doc | .cursor/rules/b2b-koi.mdc duplicates agent guidance without referencing AGENTS.md. | .cursor/rules/b2b-koi.mdc | Replace most content with a short pointer to AGENTS.md. |
| info | drift-prone-agent-doc | .cursor/rules/backend-api.mdc duplicates agent guidance without referencing AGENTS.md. | .cursor/rules/backend-api.mdc | Replace most content with a short pointer to AGENTS.md. |
| info | drift-prone-agent-doc | .cursor/rules/backend-db-ops.mdc duplicates agent guidance without referencing AGENTS.md. | .cursor/rules/backend-db-ops.mdc | Replace most content with a short pointer to AGENTS.md. |
| info | drift-prone-agent-doc | .cursor/rules/frontend-admin.mdc duplicates agent guidance without referencing AGENTS.md. | .cursor/rules/frontend-admin.mdc | Replace most content with a short pointer to AGENTS.md. |
| info | drift-prone-agent-doc | .cursor/rules/frontend-driver.mdc duplicates agent guidance without referencing AGENTS.md. | .cursor/rules/frontend-driver.mdc | Replace most content with a short pointer to AGENTS.md. |
| info | drift-prone-agent-doc | .cursor/rules/typography-hyphen.mdc duplicates agent guidance without referencing AGENTS.md. | .cursor/rules/typography-hyphen.mdc | Replace most content with a short pointer to AGENTS.md. |
| info | drift-prone-agent-doc | CLAUDE.md duplicates agent guidance without referencing AGENTS.md. | CLAUDE.md | Replace most content with a short pointer to AGENTS.md. |
| info | missing-ci | No GitHub Actions workflow was detected. | .github/workflows | Add CI so agents can trust the verification path. |
| info | missing-lint-command | No lint command was detected. | package.json | Add a lint script if the project has automated style checks. |
