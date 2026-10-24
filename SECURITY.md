# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Security Boundaries & Design

RepoTwin executes commands in separate Git worktrees (`twins`). A worktree is not an OS sandbox: project commands retain the local user's filesystem/network permissions and share Git metadata. Use only repositories and command plans you trust. Key controls include:

1. **No Automatic Execution**: Commands are never executed automatically without explicit user authorization and consent.
2. **Loopback Isolation**: The local Studio dev server binds exclusively to `127.0.0.1` and validates origin and host headers.
3. **Session Tokens**: All mutation endpoints require a cryptographically random session token (`X-RepoTwin-Token`).
4. **No Arbitrary Shell**: Commands run directly via `spawn` without shell interpolation (`shell: false`).
5. **Safe Restoration**: Files applied to the host repository are backed up with strict atomic replacement and rollback capability.
6. **Hooks disabled**: RepoTwin-managed checkout and submodule commands disable Git hooks before command consent.
7. **Source binding**: Verification/application reject changes to the recorded source state, including HEAD, index, tracked/untracked content and initialized submodules.
8. **Safe report paths**: Reports reject symlinked directories/aliases and hard-linked files and use atomic private writes. Reports are unsigned local records, not immutable certificates.

## Reporting a Vulnerability

If you discover a security issue or vulnerability in RepoTwin, please **do not open a public issue**.

Instead, please send a private security report to the repository maintainers or use GitHub's private vulnerability reporting feature.

We appreciate your responsible disclosure and will investigate and patch verified issues promptly.
