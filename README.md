# RepoTwin

RepoTwin analyses external agent reports against a repository and can create a
separate Git worktree containing a proposed instruction-file recipe.

## Launch from anywhere

Requires Node.js 22 or newer and Git. Until a package is published, build this
checkout and install it locally:

```bash
npm ci
npm run build
npm install --global /absolute/path/to/repotwin
```

Then use a target path without changing your working directory:

```bash
repotwin /path/to/any-project
repotwin studio /path/to/any-project
```

Both commands open the local Studio. `repotwin` alone targets the current
directory. Installation does not copy RepoTwin into the target project.

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

1. Inspect the repository and proposed instructions.
2. Create a candidate from Git HEAD and inspect the complete diff, including new files.
3. Review the exact test, lint and build commands detected from supported
   manifests. RepoTwin asks once before executing them inside the isolated twin.
4. Run the verification. It reads the candidate files again, executes only the
   displayed allowlisted commands without a shell, and records status, duration
   and bounded output for each command.
5. Review resolved findings and command evidence, then apply with backups.

Project tests and builds are **never automatically executed**. Commands run only
after the user confirms the displayed plan. RepoTwin does not install dependencies
or claim token savings. Missing tools, failures and timeouts are reported rather
than converted into passing checks. New documentation regressions, failed commands
and source-file changes block application; remaining pre-existing findings remain
visible.

Command execution uses no shell, a reduced environment, bounded output and a
two-minute timeout per command. Commands still contain project-controlled code and
may use the network or other resources available to the local user. Generated
Git-ignored build artifacts are removed from the managed twin after verification;
changes to source files or generated instruction files are preserved and block the
workflow for review.

The candidate contains committed files from HEAD, not the source working tree's
uncommitted changes. Dependencies and submodules are not installed automatically.
When no recognized validation command is declared, verification covers instruction
files only and explicitly reports that the application was not validated.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). CI checks tests, compilation and package
installation on Node.js 22 and 24. This checkout is not automatically published
to npm or made public on GitHub.
