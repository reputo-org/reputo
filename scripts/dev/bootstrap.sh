#!/usr/bin/env bash
# Reputo first-run bootstrap.
#
# - Copies docker/env/examples/*.env.example -> docker/env/*.env when missing.
# - Generates a real AUTH_TOKEN_ENCRYPTION_KEY in docker/env/api.env (if it
#   still has the placeholder value).
# - Prints the credentials checklist with current status.

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_DIR="${ROOT_DIR}/docker/env"
EXAMPLES_DIR="${ENV_DIR}/examples"

cd "${ROOT_DIR}"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
ok()    { printf '  \033[32m✔\033[0m %s\n' "$*"; }
info()  { printf '  \033[36m›\033[0m %s\n' "$*"; }
warn()  { printf '  \033[33m!\033[0m %s\n' "$*"; }
miss()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }

bold "Copying env examples"
mkdir -p "${ENV_DIR}"
shopt -s nullglob
for example in "${EXAMPLES_DIR}"/*.env.example; do
  target_name="$(basename "${example}" .example)"
  # Skip the self-host bundle (docker/env/prod.env). It is only used by the
  # Komodo-free deploy path and should be created explicitly by the operator.
  if [[ "${target_name}" == "prod.env" ]]; then
    continue
  fi
  target_path="${ENV_DIR}/${target_name}"
  if [[ -f "${target_path}" ]]; then
    info "${target_name} (kept existing)"
  else
    cp "${example}" "${target_path}"
    ok "${target_name} (copied from example)"
  fi
done
shopt -u nullglob

# --- generate AUTH_TOKEN_ENCRYPTION_KEY if it's still the placeholder --------
API_ENV="${ENV_DIR}/api.env"
if [[ -f "${API_ENV}" ]] && grep -q '^AUTH_TOKEN_ENCRYPTION_KEY=replace-with-a-long-random-secret' "${API_ENV}"; then
  bold "Generating AUTH_TOKEN_ENCRYPTION_KEY"
  if command -v openssl >/dev/null 2>&1; then
    new_key="$(openssl rand -hex 32)"
  elif command -v node >/dev/null 2>&1; then
    new_key="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  else
    miss "Neither openssl nor node found — fill AUTH_TOKEN_ENCRYPTION_KEY manually in ${API_ENV}"
    new_key=""
  fi
  if [[ -n "${new_key}" ]]; then
    # perl -i is portable across BSD (macOS) and GNU sed/awk implementations.
    perl -i -pe "s|^AUTH_TOKEN_ENCRYPTION_KEY=.*|AUTH_TOKEN_ENCRYPTION_KEY=${new_key}|" "${API_ENV}"
    ok "Wrote a 64-char hex secret to api.env"
  fi
else
  if [[ -f "${API_ENV}" ]]; then
    info "AUTH_TOKEN_ENCRYPTION_KEY (kept existing value in api.env)"
  fi
fi

# --- credentials checklist ---------------------------------------------------
printf '\n'
bold "Credentials checklist"
printf '\n'

is_placeholder() {
  local v="$1"
  [[ -z "${v}" || "${v}" == your-* || "${v}" == replace-with-* || "${v}" == *@example.com || "${v}" == mock-* ]]
}

check_value() {
  local file="$1" key="$2" label="$3" required="$4"
  if [[ ! -f "${file}" ]]; then
    miss "${label}: ${file} not found"
    return
  fi
  local raw value
  raw="$(grep -E "^${key}=" "${file}" | tail -n1 || true)"
  value="${raw#*=}"
  if is_placeholder "${value}"; then
    if [[ "${required}" == "yes" ]]; then
      miss "${label} (${key} in $(basename "${file}")) — required"
    else
      warn "${label} (${key} in $(basename "${file}")) — optional, not set"
    fi
  else
    ok "${label}"
  fi
}

check_value "${ENV_DIR}/api.env"        AUTH_TOKEN_ENCRYPTION_KEY  "Auth token encryption key"      yes
check_value "${ENV_DIR}/api.env"        OWNER_EMAIL                "Owner email (oauth mode only)"  no
check_value "${ENV_DIR}/workflows.env"  DEEPFUNDING_API_KEY        "DeepFunding portal API key"     no
check_value "${ENV_DIR}/workflows.env"  ALCHEMY_API_KEY            "Alchemy API key"                no
check_value "${ENV_DIR}/workflows.env"  BLOCKFROST_API_KEY         "Blockfrost API key (Cardano)"   no
check_value "${ENV_DIR}/api.env"        DEEP_ID_CLIENT_ID          "Deep ID client ID (oauth mode)" no
check_value "${ENV_DIR}/api.env"        DEEP_ID_CLIENT_SECRET      "Deep ID client secret"          no

printf '\n'
bold "Next steps"
cat <<EOS
  1. Review docker/env/*.env files — defaults are fine for first run.
  2. ${0##*/} can be re-run safely.
  3. Bring the stack up:    make up
  4. Tail a service:        make logs SVC=api
  5. Stop the stack:        make down
  6. Browse:
       - UI:                http://localhost
       - API:               http://localhost/api
       - Temporal UI:       http://localhost:8088
       - Grafana:           http://localhost:3001  (admin/admin)
       - MinIO console:     http://minio.localhost  (reputo/reputo-dev-secret)

See docs/onboarding.md for the full guide.
EOS
