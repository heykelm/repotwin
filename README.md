# RepoTwin

### Inspect repository instructions and verify proposed changes in Git worktrees.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen.svg)](package.json)
[![OS](https://img.shields.io/badge/os-macOS%20%7C%20Windows%20%7C%20Linux-blue.svg)](#cross-platform--resource-efficiency)
[![Security: Isolated Twins](https://img.shields.io/badge/security-isolated%20twins-emerald.svg)](SECURITY.md)

**RepoTwin** helps developers maintain repository instructions for AI coding assistants. It inventories projects, checks instruction references and declared commands, and proposes an updated `AGENTS.md` and `agent-ready.json` while preserving custom directives.

After command authorization, RepoTwin runs declared checks in a separate Git worktree and records results, durations, instruction findings and the applied diff. Scores describe the checks performed; AI usage, financial savings and assistant behavior are not measured. Reports are local records, not signed or tamper-proof certificates.

> 🌐 **Bilingual Studio UI & Certificates**: English by default for open-source teams worldwide, with an instant `[ EN | FR ]` switcher in both the Studio and generated HTML certificates that persists user preferences across reloads.

## Quickstart

Requires Node.js 22.12 or newer and Git. Install the published CLI:

```bash
npm install --global repotwin@latest
repotwin /path/to/any-project
```

To develop RepoTwin locally:

```bash
npm ci
npm run build
npm install --global /absolute/path/to/repotwin
```

Launch RepoTwin Studio for any repository from anywhere:

```bash
repotwin /path/to/any-project
# or explicitly
repotwin studio /path/to/any-project
```

The Studio opens on `http://127.0.0.1:<port>` with loopback-only isolation. It uses a compiled React + shadcn UI client with Radix primitives, Tailwind CSS 4, and Lucide icons shipped directly in the package—no external CDNs or telemetry required.

## ⚡ Token Efficiency & Context Budget (New in v0.3.0)

Test output can consume part of an agent's context. RepoTwin can summarize captured failures when verifying a RepoTwin candidate in an isolated worktree.

### Twin Compact Sieve (`repotwin_run_checks`)

Failure summaries are best effort. The MCP response also includes the captured raw output so that partially recognized failures remain visible. Output capture is bounded; `outputTruncated` indicates when part of the command output was not captured. Successful commands return their status without their logs.

For an opt-in smaller initial response, pass `lazyLogs: true` to `repotwin_run_checks`. Failed checks include a `commandId` as `id`; use that ID and the candidate ID with `repotwin_get_log` to retrieve missing details by `tail`, `offset`/`limit`, or bounded byte pages. Successful checks also expose their ID. Logs are kept only in the current MCP session up to 8 MiB per command; inspect `retrievableLogTruncated` before relying on them. The inline `outputTruncated` flag describes the separate 64 KiB response limit. Re-running a command replaces its retained log. A summary may omit important information; inspect the log when in doubt.

**No general token, quota, or cost saving has been established.** Exploratory agent runs have shown both increases and decreases. A shorter summary does not establish savings for the whole task, and reading logs or other files adds context. See the [evaluation notes](https://github.com/heykelm/repotwin/blob/main/docs/benchmarks/REAL-WORKFLOW-EVALUATION.md) for scope and limitations.

### 3. Context Budget Audit (`repotwin analyze`)
RepoTwin statically audits your repository for AI token efficiency:
- **Instruction Weight**: Estimates the size of selected instruction files. Actual loading and tokenization depend on the agent.
- **Context Hogs**: Identifies source files over 500 lines for inspection; it does not measure agent reads.
- **Command Verbosity**: Flags test scripts lacking quiet/compact flags.

## Cross-Platform & Resource Efficiency

RepoTwin is engineered for reliable execution across all major platforms with minimal resource consumption:

- **Platforms**: CI runs on Linux with Node.js 22 and 24; local release verification also uses macOS. Windows paths and command names are handled in code, but Windows execution is not covered by the current CI matrix.
- **Local UI**: Compiled React assets are served from the installed package on `127.0.0.1`. No hosted application or AI API key is needed.
- **Bounded command output**: Inline stdout/stderr defaults to 64 KiB per command. MCP keeps up to 8 MiB per command in session memory for paginated `repotwin_get_log` retrieval. Both inline and retrievable truncation are reported explicitly; logs expire when the server ends, the candidate is cleaned, or the command is rerun.
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
repotwin setup-mcp                     # Auto-configures detected JSON-based MCP clients
repotwin setup-mcp cursor claude-desktop gemini antigravity --dry-run
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

MCP write operations follow the same guarded workflow as Studio: create a
managed candidate, review the disclosed command plan, verify it inside the
Twin, then apply with the one-time verification token. Direct checks against
the source repository and unverified application are rejected. Restarting the
MCP server expires all candidate and verification tokens.

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

When verified instructions are applied locally, RepoTwin produces a recorded audit snapshot:
- **HTML & JSON reports**: Saved under `.repotwin/reports/` with timestamped unique names and backwards-compatible `repotwin-certificate-latest` aliases. Reports include before/after findings, executed validation commands and the source commit/fingerprint.
- **Before / After Comparison**: Captures instruction scores, estimated instruction size, and execution timings. It does not infer AI usage savings.
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
## Recorded Results and Scope

Studio shows current/proposed instruction sizes, the findings-based score and actual recorded command coverage. Size uses an approximate characters/4 estimate, not a model-specific tokenizer. Expanding useful instructions can increase this size.

Project discovery traverses up to eight levels, 2,500 directories and 200 projects, including nested projects below package boundaries. Dependency/build/cache directories are excluded. Reached limits and unreadable directories produce explicit findings instead of an implied complete inventory.

Verification and application bind to a source fingerprint covering HEAD, staged/unstaged changes, untracked file content and initialized submodules. Changing the source invalidates the candidate. Commands still run against committed HEAD, not uncommitted application changes; commit intended code changes before creating a candidate when you want them included in the executed checks.

Git hooks are disabled during RepoTwin-managed Git operations. Worktrees share Git object storage and run commands with the local user's permissions; they are not OS sandboxes. Use trusted repositories and review command scripts before authorizing execution.

Local report paths reject symbolic links, non-regular files and hard-linked report targets. Report writes use private permissions and atomic replacement. Global archival is best-effort; the local report remains the primary record.

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
