# RepoTwin

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen.svg)](package.json)
[![OS](https://img.shields.io/badge/os-macOS%20%7C%20Windows%20%7C%20Linux-blue.svg)](#cross-platform--resource-efficiency)
[![Security: Isolated Twins](https://img.shields.io/badge/security-isolated%20twins-emerald.svg)](SECURITY.md)

RepoTwin is an open-source reliability and instruction-optimization engine for AI coding agents (Cursor, Claude Code, Gemini Antigravity, GitHub Copilot, Codex).

It audits repository-local instructions (`AGENTS.md`, `.cursorrules`, `.claude/rules`), detects documentation drift and ghost scripts, validates builds and test suites in **isolated Git Twins** with parallel subproject workers, simulates AI subscription ROI and token savings, and generates tamper-proof **Optimization & Deployment Certificates**.

> 🌐 **Bilingual Studio UI & Certificates**: English by default for open-source teams worldwide, with an instant `[ EN | FR ]` switcher in both the Studio and generated HTML certificates that persists user preferences across reloads.

## Cross-Platform & Resource Efficiency

RepoTwin is engineered for reliable execution across all major platforms with minimal resource consumption:

- **Cross-Platform Compatibility**: Fully supported on **macOS**, **Windows 10/11**, and **Linux**. On Windows, package managers (`npm.cmd`, `pnpm.cmd`, `yarn.cmd`, `npx.cmd`) and path conventions (`\` and `%APPDATA%`) are resolved automatically without requiring WSL or external shells.
- **Ultra-Low Memory Footprint**: RepoTwin's server and studio consume less than **60 MB of RAM** at runtime. The compiled Studio UI is under **300 KB gzipped** and served loopback-only (`127.0.0.1`).
- **Bounded Log Buffers (Anti-OOM)**: Test and build outputs are capped via ring buffers (`maxOutputBytes = 10 MB`). Even verbose suites generating gigabytes of logs will never cause Node.js out-of-memory errors.
- **Bounded Concurrency**: Subproject checks default to 3 concurrent workers (`REPOTWIN_CONCURRENCY=3`), preventing CPU and RAM exhaustion on large monorepos with dozens of projects.
- **Disk-Efficient Git Twins**: Twins leverage `git worktree add`, sharing Git object storage with your primary repository without duplicating repository history. All temporary twins are cleanly removed upon completion.

## Safety model

- `analyze` is read-only unless `--html` is explicitly selected.
- `fix` previews changes by default. It writes only with `--apply`.
- `twin create` creates an isolated Git worktree. `twin clean` removes only
  clean worktrees created inside RepoTwin's managed cache directory.
- Repo paths are passed directly to Git without a shell.

## Usage

```bash
repotwin analyze /path/to/repo --from-report audit.json --json
repotwin fix /path/to/repo
repotwin fix /path/to/repo --apply
repotwin twin create /path/to/repo
repotwin twin clean /path/to/repo
repotwin ui /path/to/repo --from-report audit.json
repotwin verify /path/to/repo
repotwin mcp /path/to/repo
repotwin setup-mcp                     # Auto-configures Cursor, Claude Desktop, Gemini/Antigravity, Windsurf
repotwin setup-mcp cursor claude --dry-run
repotwin history                       # Centralized registry of all audits across repositories
```

Studio listens on 127.0.0.1. Mutations require a session token and a same-origin
request. Applying requires a candidate and stores backups under
`.repotwin/backups/`. Symbolic-link destinations are rejected.

Cleanup preserves staged, committed, ignored, and manually edited work. Legacy
twins without a recorded base commit are preserved for manual review.
Imported-report scores are shown only for an explicitly selected report.
RepoTwin also performs a separate fresh audit of instruction files. This
weighted documentation score is not a measure of code quality or AI efficiency.

## Candidate workflow

The initial audit inventories repository-local `AGENTS.md`, `AGENTS.override.md`,
`CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.cursor/rules` and `.claude/rules`
files, including nested project scopes. Findings identify the source line and
suggest a correction when a local Markdown reference is missing or an explicit
`npm run`, `pnpm run` or `yarn run` command names an absent package script.
The CLI JSON output includes the inventory and any inspection limits.
These are factual consistency checks, not a guarantee that an assistant loads
every file or that natural-language instructions are semantically compatible.
Ambiguous commands and prose are not automatically rewritten. User-global
instructions and symlinked files are not inspected. The inventory is bounded
to eight directory levels, 2,500 directories, 200 files and 256 KiB per file;
any reached limit is reported.

Studio separates **Instructions du dépôt** and **Comparer deux versions** into
two tabs. The instruction workflow has four stages: diagnostic, proposal,
verification, and application. Its action bar stays visible while scrolling.
Creating a twin selects verification and explicitly waits for command consent;
it does not silently start a run. Completed results and the diff are restored
after a page reload within the same server session.

1. Inspect the repository and proposed instructions.
2. Create a candidate from Git HEAD and inspect the complete diff, including new files.
3. Review the exact test, lint and build commands detected from supported
   manifests. RepoTwin asks once before executing them inside the isolated twin.
4. Run the verification. It reads the candidate files again, executes only the
   displayed allowlisted commands without a shell, and records status, duration
   and bounded output for each command.
5. Review resolved findings and command evidence, then apply with backups.

Project tests and builds are **never automatically executed**. Commands run only
after the user confirms the displayed plan. Lockfile installations are part of
that plan. RepoTwin does not claim token savings. Missing tools, failures and timeouts are reported rather
than converted into passing checks. New documentation regressions, failed commands
and source-file changes block application; remaining pre-existing findings remain
visible.

Command execution uses no shell, a reduced environment, bounded output and a
two-minute timeout per control (ten minutes for installation). Commands still contain project-controlled code and
may use the network or other resources available to the local user. Generated
Git-ignored build artifacts are removed from the managed twin after verification;
changes to source files or generated instruction files are preserved and block the
workflow for review.

### Parallel Subproject Verification

For monorepos and multi-project repositories, RepoTwin accelerates verification through **safe subproject-level concurrency**:
- **Strictly sequential within a project**: Within each subproject directory, execution strictly follows order (`install` → `test` → `lint` → `build`). If dependency installation fails, subsequent checks for that project are skipped automatically.
- **Concurrent across distinct projects**: Independent subprojects execute in parallel (up to 3 concurrent workers by default, customizable via `REPOTWIN_CONCURRENCY`). This typically halves total verification time on multi-project repositories while avoiding lockfile and cache race conditions.

### Application Snapshot & Verification Proof

When verified instructions are applied locally, RepoTwin produces an immutable audit snapshot:
- **Certified HTML & JSON Reports**: Saved under `.repotwin/reports/repotwin-certificate-<timestamp>.html` (and mirrored at `repotwin-certificate-latest.html`), providing a permanent record of before/after scores, resolved anomalies, and executed validation commands.
- **Before / After Comparison**: Captures instruction health score improvements, token economy savings, and execution timings for every test command.
- **Controlled Backup**: Original files are backed up to a dedicated folder under `.repotwin/backups/` before any change is written.


The candidate contains committed files from HEAD, not the source working tree's
uncommitted changes. With command consent, dependencies are installed from
supported lockfiles; submodules are initialized from available local clones.
When no recognized validation command is declared, verification covers instruction
files only and explicitly reports that the application was not validated.

Targeted retries keep other results for the same unchanged candidate, reinstall
approved lockfile dependencies when needed, and require complete successful
coverage before enabling application. A candidate-only failure is never labelled
pre-existing without an actual reference comparison. Local source changes and
untracked or ignored environment files are not automatically synchronized into
the candidate. Estimates of instruction size use characters divided by four;
they are not tokenizer measurements or measured consumption per prompt.

## Compare Two Commits

Studio includes a separate comparison panel. Choose a reference and target
revision, review the commands and npm script definitions for both sides, then
authorize execution. Both revisions are pinned to commit hashes and checked out
in temporary detached worktrees. Your working directory and uncommitted changes
are not used or modified. Progress counts completed commands rather than
estimating time remaining. Results and bounded logs can be exported as JSON.

The same workflow is available from the CLI:

```bash
repotwin compare /path/to/repo --base HEAD~1 --target HEAD
repotwin compare /path/to/repo --base HEAD~1 --target HEAD --execute
```

The first command previews the plan without running project commands. The
`--execute` flag explicitly authorizes installation and execution on both sides.
Exit status is 1 when a regression is observed, 2 when coverage is incomplete,
and 0 when no regression was observed on the comparable controls.

Results distinguish pass-to-fail, fail-to-pass, failure on both sides, success
on both sides, and unverified controls. Failure on both sides does not prove
that the underlying cause is identical. Timeouts, missing controls and changed
npm script/lifecycle definitions are not classified as fixed or regressed.
Commands that modify tracked or non-ignored source files invalidate comparison;
their temporary checkout is preserved for inspection. Clean temporary checkouts,
including their ignored build artifacts, are removed after the run.

Only commands discovered by the existing project scanner are covered. No
dependencies are installed for projects without a supported lockfile. External
services, machine state and flaky tests can affect outcomes; the report is
evidence about executed controls, not proof that the entire application works.
Comparison does not apply, merge or commit any changes.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). CI checks tests, compilation and package
installation on Node.js 22 and 24. This checkout is not automatically published
to npm or made public on GitHub.
