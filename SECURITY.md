# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Security Boundaries & Design

RepoTwin executes commands inside isolated Git worktrees (`twins`). Key security principles include:

1. **No Automatic Execution**: Commands are never executed automatically without explicit user authorization and consent.
2. **Loopback Isolation**: The local Studio dev server binds exclusively to `127.0.0.1` and validates origin and host headers.
3. **Session Tokens**: All mutation endpoints require a cryptographically random session token (`X-RepoTwin-Token`).
4. **No Arbitrary Shell**: Commands run directly via `spawn` without shell interpolation (`shell: false`).
5. **Safe Restoration**: Files applied to the host repository are backed up with strict atomic replacement and rollback capability.

## Reporting a Vulnerability

If you discover a security issue or vulnerability in RepoTwin, please **do not open a public issue**.

Instead, please send a private security report to the repository maintainers or use GitHub's private vulnerability reporting feature.

We appreciate your responsible disclosure and will investigate and patch verified issues promptly.
