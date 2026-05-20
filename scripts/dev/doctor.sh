#!/usr/bin/env bash
# Reputo preflight checks.
#
# Validates that required tools are installed at the pinned versions and
# warns about likely-conflicting host ports. Exits 0 on success, 1 if any
# required check fails.

set -uo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; failures=$((failures+1)); }

failures=0

require_node="$(tr -d '[:space:]' < "${ROOT_DIR}/.nvmrc" 2>/dev/null)"
require_pnpm="$(grep -E '"packageManager"' "${ROOT_DIR}/package.json" 2>/dev/null \
  | sed -E 's/.*"pnpm@([^"]+)".*/\1/')"

printf '\033[1mTooling\033[0m\n'

if command -v docker >/dev/null 2>&1; then
  docker_v="$(docker --version | head -n1)"
  ok "docker: ${docker_v}"
else
  fail "docker is required (https://docs.docker.com/engine/install/)"
fi

if docker compose version >/dev/null 2>&1; then
  compose_v="$(docker compose version --short 2>/dev/null || docker compose version)"
  ok "docker compose: ${compose_v}"
else
  fail "docker compose plugin missing"
fi

if command -v mise >/dev/null 2>&1; then
  ok "mise: $(mise --version | head -n1)"
else
  warn "mise not installed — recommended (https://mise.jdx.dev/). nvm/Volta/manual installs are OK if versions match."
fi

if command -v node >/dev/null 2>&1; then
  node_v="$(node --version | sed 's/^v//')"
  if [[ -n "${require_node}" && "${node_v}" != "${require_node}" ]]; then
    fail "node ${node_v} — expected ${require_node} (from .nvmrc). Run: mise install   or:   nvm use"
  else
    ok "node: ${node_v}"
  fi
else
  fail "node is required (expected ${require_node:-pinned in .nvmrc})"
fi

if command -v pnpm >/dev/null 2>&1; then
  pnpm_v="$(pnpm --version)"
  if [[ -n "${require_pnpm}" && "${pnpm_v}" != "${require_pnpm}" ]]; then
    warn "pnpm ${pnpm_v} — expected ${require_pnpm} (from package.json packageManager). Run: corepack enable"
  else
    ok "pnpm: ${pnpm_v}"
  fi
else
  fail "pnpm is required (run: corepack enable && corepack prepare pnpm@${require_pnpm:-10.30.3} --activate)"
fi

if command -v jq >/dev/null 2>&1; then
  ok "jq: $(jq --version)"
else
  warn "jq missing — only required for some scripts and CI parity"
fi

printf '\n\033[1mVersion drift\033[0m\n'
if [[ -n "${require_node}" ]]; then
  while IFS= read -r df; do
    pinned="$(grep -E '^ARG NODE_VERSION=' "${df}" | head -n1 | cut -d= -f2)"
    rel="${df#${ROOT_DIR}/}"
    if [[ -z "${pinned}" ]]; then
      continue
    elif [[ "${pinned}" != "${require_node}" ]]; then
      fail "${rel} pins Node ${pinned}, expected ${require_node} (from .nvmrc)"
    else
      ok "${rel} matches .nvmrc"
    fi
  done < <(find "${ROOT_DIR}/apps" "${ROOT_DIR}/docker/images" \
    \( -name Dockerfile -o -name 'Dockerfile.*' \) 2>/dev/null | sort)
fi

printf '\n\033[1mPort availability\033[0m\n'
check_port() {
  local port="$1" label="$2"
  if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    warn "port ${port} (${label}) already in use — make up will conflict"
  else
    ok "port ${port} (${label}) free"
  fi
}

check_port 80    "Traefik HTTP (UI/API)"
check_port 8080  "Traefik dashboard"
check_port 3001  "Grafana"
check_port 8088  "Temporal UI"
check_port 9000  "MinIO S3 API"
check_port 9001  "MinIO console"
check_port 27017 "MongoDB"
check_port 5433  "Onchain Postgres"

printf '\n'
if [[ "${failures}" -gt 0 ]]; then
  printf '\033[31mDoctor found %d required problem(s).\033[0m\n' "${failures}"
  exit 1
fi
printf '\033[32mDoctor passed.\033[0m Run `make bootstrap` (first time) or `make up` to start the stack.\n'
