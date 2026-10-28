#!/usr/bin/env bash
# ==============================================================================
# RepoTwin — Universal MCP Configuration for AI Coding Agents & IDEs
# Supports: Cursor, Claude Desktop, Gemini Antigravity, Claude Code, Windsurf
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# If repotwin is installed globally via npm, use it
if command -v repotwin >/dev/null 2>&1; then
  echo "Using global repotwin binary..."
  exec repotwin setup-mcp "$@"
fi

# Fallback to local built binary
if [[ ! -f "${REPO_ROOT}/dist/index.js" ]]; then
  echo "Building RepoTwin..."
  (cd "${REPO_ROOT}" && npm run build:server)
fi

exec node "${REPO_ROOT}/dist/index.js" setup-mcp --bin "${REPO_ROOT}/dist/index.js" "$@"
