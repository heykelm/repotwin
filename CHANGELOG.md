# Changelog

## 0.3.1

- Retain bounded command logs for the active MCP session and retrieve them in pages with `repotwin_get_log`; opt in to shorter initial failure responses with `lazyLogs`.
- Preserve diagnostics beyond the inline 64 KiB limit up to a separate 8 MiB per-command session limit, with explicit truncation indicators.
- Improve test-failure summaries and document that initial payload reductions do not establish task-level token, cost or quota savings.
- Keep extended MCP logs out of Studio and revision comparison responses.

## 0.3.0

- **Twin Compact Sieve**: Provides best-effort summaries of test output in MCP checks (`repotwin_run_checks`). Diagnostic extraction may be incomplete; no token savings have been measured.
- **Context Budget & Token Efficiency Audit**: Static audit in `repotwin analyze` and MCP tool `repotwin_token_audit`. Measures base prompt instruction token overhead, flags large source files (>500 lines) that cause excessive AI re-reads, and scores repository token efficiency (0-100).
- **Universal Multi-IDE MCP Setup**: Expand `setup-mcp` to support Cursor, Claude Desktop, Gemini Antigravity, Claude Code CLI, Windsurf, and VS Code (Roo Code / Cline) with automated 1-click detection and atomic configuration updates.
- **English-First Bilingual Reports**: Default generated HTML reports and CLI diagnostic summaries to English, preserving instant bilingual `[ EN | FR ]` switcher.

## 0.2.0

- Hybrid report design, pipeline audit trail and live verification execution in isolated Git worktrees.

- Add concrete gains to application reports, comparing applied files with their backups and separating observed changes from expected benefits.
- Show the gain details in English and French, with recorded command results as evidence where available.

## 0.1.3

- Disable Git hooks during candidate creation and submodule operations.
- Bind Studio and MCP verification/application to source HEAD and content fingerprints, including staged changes, untracked files and initialized submodules.
- Secure local/global report writes against symlinks and hard-linked files; use private permissions and atomic replacement.
- Replace fabricated AI savings, perfect scores and security guarantees with recorded instruction sizes, findings scores and command coverage.
- Discover nested projects to eight levels with explicit coverage-limit notices.
- Refresh generated configuration fields while preserving custom settings and protected paths.
- Share command/audit assessment between Studio and MCP; remove the unused legacy Studio renderer.
- Add Studio typechecking to the build and regression coverage for these scenarios.

## 0.1.2

- Derive CLI, MCP and report version from package metadata.

## 0.1.1

- Require verified MCP candidates and one-use tokens for application; harden MCP configuration installation.
