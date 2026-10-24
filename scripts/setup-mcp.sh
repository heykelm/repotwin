#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if command -v repotwin >/dev/null 2>&1; then
  exec repotwin setup-mcp "$@"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js 22.12 or newer is required." >&2
  exit 1
fi

if [[ ! -f "${REPO_ROOT}/dist/index.js" ]]; then
  echo "Error: RepoTwin is not built. Run npm run build first." >&2
  exit 1
fi

exec node "${REPO_ROOT}/dist/index.js" setup-mcp --bin "${REPO_ROOT}/dist/index.js" "$@"
