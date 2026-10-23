# Contributing to RepoTwin

Use Node.js 22 or newer and Git. Install with `npm ci`, run `npm test`, and build
with `npm run build`. Packaging runs the build through `prepack`.

Tests that create worktrees must use disposable repositories and an isolated
`REPOTWIN_TWINS_DIR`. Never use real projects to test cleanup or application.

Keep imported reports separate from freshly measured checks. A documentation
score must not be presented as a code-quality score, passing application tests,
or a measured reduction in model usage. Do not suppress a zero score.

Do not automatically execute scripts discovered in an inspected repository.
Any future test runner needs explicit selection of commands and clear results,
timeouts, output bounds, and a documented execution boundary.

Preserve existing user directives and configuration. Include regression tests
for Git cleanup, new files in diffs, modified candidates, symlink targets, HTTP
origin checks, and repeated application where relevant.

Before making a repository public, inspect fixtures, reports and Git history
for private project data, contact details, credentials, and licensing issues.
Use minimal synthetic fixtures for new tests. Opening a GitHub pull request
does not authorize publishing to npm.
