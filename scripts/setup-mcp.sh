#!/usr/bin/env bash
# ==============================================================================
# RepoTwin — Script Universel de Configuration MCP pour IDEs & Clients IA
# Supporte : Cursor, Claude Desktop, Gemini / Antigravity, Windsurf
# OS supportés : macOS, Linux, Windows (WSL/Git Bash)
# ==============================================================================

set -e

# Couleurs pour le terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Paramètres par défaut
DRY_RUN=false
TARGETS=()
BIN_PATH="repotwin"

# Trouver le binaire repotwin si disponible dans PATH ou localement
if command -v repotwin >/dev/null 2>&1; then
    BIN_PATH="repotwin"
elif [ -f "$(dirname "$0")/../dist/index.js" ]; then
    BIN_PATH="$(cd "$(dirname "$0")/.." && pwd)/dist/index.js"
fi

print_help() {
    cat <<EOF
${BOLD}RepoTwin MCP Setup — Configuration universelle pour IDEs et Clients IA${NC}

${BOLD}UTILISATION :${NC}
    ./setup-mcp.sh [OPTIONS] [CIBLES...]

${BOLD}CIBLES DISPONIBLES :${NC}
    cursor          Configure Cursor (~/.cursor/mcp.json)
    claude          Configure Claude Desktop (claude_desktop_config.json)
    gemini          Configure Gemini / Antigravity (~/.gemini/config/mcp_config.json)
    windsurf        Configure Windsurf (~/.codeium/windsurf/mcp_config.json)
    all             Configure automatiquement tous les IDEs détectés (Défaut)

${BOLD}OPTIONS :${NC}
    -d, --dry-run   Affiche ce qui serait modifié sans écrire sur le disque
    -b, --bin <cmd> Spécifie la commande ou le chemin de l'exécutable repotwin (défaut: "${BIN_PATH}")
    -h, --help      Affiche cette aide

${BOLD}EXEMPLES :${NC}
    ./setup-mcp.sh                      # Configure automatiquement tous les IDEs présents
    ./setup-mcp.sh cursor gemini        # Configure uniquement Cursor et Gemini
    ./setup-mcp.sh --dry-run            # Simule l'installation sans toucher aux fichiers
EOF
}

# Parser les arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            print_help
            exit 0
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -b|--bin)
            BIN_PATH="$2"
            shift 2
            ;;
        cursor|claude|gemini|antigravity|windsurf|all)
            TARGETS+=("$1")
            shift
            ;;
        *)
            echo -e "${RED}Option ou cible inconnue : $1${NC}"
            print_help
            exit 1
            ;;
    esac
done

echo -e "${CYAN}${BOLD}\n⚙️  RepoTwin — Assistant de Configuration Universelle MCP${NC}"
echo -e "======================================================================"

# Utiliser le helper Node.js intégré à RepoTwin pour effectuer la fusion sécurisée
SETUP_JS_CODE="
const { runMcpSetup } = require('../dist/mcp/installer.js');
runMcpSetup({
  targets: ${#TARGETS[@]} > 0 ? $(printf '%s\n' "${TARGETS[@]}" | jq -R . | jq -s . 2>/dev/null || echo "['${TARGETS[*]}']") : ['all'],
  dryRun: ${DRY_RUN},
  binPath: '${BIN_PATH}'
});
"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Vérifier si Node.js est disponible
if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}Erreur : Node.js est requis pour exécuter ce script.${NC}"
    exit 1
fi

node -e "
const path = require('path');
const installerPath = path.join('${REPO_ROOT}', 'dist', 'mcp', 'installer.js');
try {
  const { runMcpSetup } = require(installerPath);
  const targets = ${#TARGETS[@]} > 0 ? [${TARGETS[*]/#/\"}] : ['all'];
  runMcpSetup({
    targets: '${TARGETS[*]}'.trim().length > 0 ? '${TARGETS[*]}'.split(' ') : ['all'],
    dryRun: ${DRY_RUN},
    binPath: '${BIN_PATH}'
  });
} catch (e) {
  console.error('Erreur lors du chargement de l\'installateur RepoTwin :', e.message);
  process.exit(1);
}
"
