#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ENV_FILE="${SCRIPT_DIR}/periphery.env"
INSTALL_DIR="${KOMODO_PERIPHERY_INSTALL_DIR:-/etc/komodo/periphery}"
ENV_FILE="${ENV_FILE:-$DEFAULT_ENV_FILE}"
COMPOSE_FILE="${INSTALL_DIR}/docker-compose.yml"
INSTALLED_ENV_FILE="${INSTALL_DIR}/periphery.env"
DRY_RUN=0
PULL=1
START=1
ALLOW_PUBLIC_BIND=0

usage() {
    cat <<'EOF'
Usage: infra/komodo/periphery/install.sh [options]

Installs or updates the Komodo Periphery container on a staging/production host.
Run this on the target host after creating a periphery.env file from
infra/komodo/periphery/periphery.env.example.

Options:
  --env-file PATH        Source env file. Default: infra/komodo/periphery/periphery.env
  --install-dir PATH     Install directory. Default: /etc/komodo/periphery
  --dry-run             Print actions without changing files or containers
  --no-pull             Skip docker compose pull
  --skip-up             Write files but do not start/update the container
  --allow-public-bind   Permit PERIPHERY_PUBLISH_IP=0.0.0.0/[::]
  -h, --help            Show this help
EOF
}

log() {
    printf '[komodo-periphery] %s\n' "$*"
}

die() {
    printf '[komodo-periphery] ERROR: %s\n' "$*" >&2
    exit 1
}

quote_cmd() {
    printf '+'
    printf ' %q' "$@"
    printf '\n'
}

run() {
    if [ "$DRY_RUN" -eq 1 ]; then
        quote_cmd "$@"
    else
        "$@"
    fi
}

run_root() {
    if [ "$(id -u)" -eq 0 ]; then
        run "$@"
    elif command -v sudo >/dev/null 2>&1; then
        run sudo "$@"
    else
        die "root privileges are required to write ${INSTALL_DIR}; rerun as root or install sudo"
    fi
}

env_value() {
    local key="$1"
    local line value

    line="$(
        awk -v key="$key" '
            /^[[:space:]]*(#|$)/ { next }
            {
                current = $0
                sub(/\r$/, "", current)
                sub(/^[[:space:]]*export[[:space:]]+/, "", current)
                split(current, parts, "=")
                candidate = parts[1]
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", candidate)
                if (candidate == key) {
                    sub(/^[^=]*=/, "", current)
                    print current
                    exit
                }
            }
        ' "$ENV_FILE"
    )"

    value="${line#"${line%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    printf '%s' "$value"
}

require_env() {
    local key="$1"
    local value
    value="$(env_value "$key")"
    [ -n "$value" ] || die "${key} must be set in ${ENV_FILE}"
    case "$value" in
        CHANGE_ME*|your_*|changeme*)
            die "${key} still contains a placeholder value in ${ENV_FILE}"
            ;;
    esac
    printf '%s' "$value"
}

is_public_bind() {
    case "$1" in
        0.0.0.0|::|\[::\]|''|'*')
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

is_allow_all_cidr() {
    local normalized
    normalized="${1//[[:space:]]/}"

    case "$normalized" in
        *0.0.0.0/0*|*::/0*|0.0.0.0|::|\[::\]|''|'*')
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --env-file)
            [ "$#" -ge 2 ] || die "--env-file requires a path"
            ENV_FILE="$2"
            shift 2
            ;;
        --install-dir)
            [ "$#" -ge 2 ] || die "--install-dir requires a path"
            INSTALL_DIR="$2"
            COMPOSE_FILE="${INSTALL_DIR}/docker-compose.yml"
            INSTALLED_ENV_FILE="${INSTALL_DIR}/periphery.env"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        --no-pull)
            PULL=0
            shift
            ;;
        --skip-up)
            START=0
            shift
            ;;
        --allow-public-bind)
            ALLOW_PUBLIC_BIND=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            die "unknown option: $1"
            ;;
    esac
done

[ -f "$ENV_FILE" ] || die "env file not found: ${ENV_FILE}"

PUBLISH_IP="$(require_env PERIPHERY_PUBLISH_IP)"
ALLOWED_IPS="$(require_env PERIPHERY_ALLOWED_IPS)"
require_env KOMODO_PASSKEY >/dev/null
PERIPHERY_PORT_VALUE="$(env_value PERIPHERY_PORT)"
PERIPHERY_PORT_VALUE="${PERIPHERY_PORT_VALUE:-8120}"
PERIPHERY_ROOT_DIRECTORY_VALUE="$(env_value PERIPHERY_ROOT_DIRECTORY)"
PERIPHERY_ROOT_DIRECTORY_VALUE="${PERIPHERY_ROOT_DIRECTORY_VALUE:-/etc/komodo}"
PERIPHERY_NETWORK_VALUE="$(env_value PERIPHERY_DOCKER_NETWORK)"
PERIPHERY_NETWORK_VALUE="${PERIPHERY_NETWORK_VALUE:-reputo}"

if is_public_bind "$PUBLISH_IP" && [ "$ALLOW_PUBLIC_BIND" -ne 1 ]; then
    die "PERIPHERY_PUBLISH_IP=${PUBLISH_IP} would publish on every interface. Set it to the host private/VPN IP, or pass --allow-public-bind only when an external firewall already limits ${PERIPHERY_PORT_VALUE}/tcp to Core."
fi

if is_allow_all_cidr "$ALLOWED_IPS"; then
    die "PERIPHERY_ALLOWED_IPS must be Core's IP/CIDR or a VPN CIDR, not ${ALLOWED_IPS}"
fi

DOCKER=(docker)
if [ "$DRY_RUN" -eq 0 ]; then
    [ -S /var/run/docker.sock ] || die "/var/run/docker.sock not found; install Docker Engine first"
    command -v docker >/dev/null 2>&1 || die "docker command not found"

    if ! docker info >/dev/null 2>&1; then
        if command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
            DOCKER=(sudo docker)
        else
            die "current user cannot access Docker; add it to the docker group or rerun with sudo"
        fi
    fi
    "${DOCKER[@]}" compose version >/dev/null 2>&1 || die "Docker Compose plugin is required"
fi

tmp_compose="$(mktemp)"
tmp_env="$(mktemp)"
cleanup() {
    rm -f "$tmp_compose" "$tmp_env"
}
trap cleanup EXIT

cat > "$tmp_compose" <<'YAML'
name: komodo-periphery

networks:
    reputo:
        external: true
        name: ${PERIPHERY_DOCKER_NETWORK:-reputo}

volumes:
    keys:
        name: ${PERIPHERY_KEYS_VOLUME:-komodo-periphery-keys}

services:
    periphery:
        image: ghcr.io/moghtech/komodo-periphery:${COMPOSE_KOMODO_IMAGE_TAG:-2}
        container_name: ${PERIPHERY_CONTAINER_NAME:-komodo-periphery}
        init: true
        restart: unless-stopped
        env_file:
            - ./periphery.env
        environment:
            TZ: ${TZ:-Europe/Vienna}
            PERIPHERY_SERVER_ENABLED: ${PERIPHERY_SERVER_ENABLED:-true}
            PERIPHERY_PORT: ${PERIPHERY_PORT:-8120}
            PERIPHERY_BIND_IP: ${PERIPHERY_BIND_IP:-0.0.0.0}
            PERIPHERY_SSL_ENABLED: ${PERIPHERY_SSL_ENABLED:-false}
            PERIPHERY_ROOT_DIRECTORY: ${PERIPHERY_ROOT_DIRECTORY:-/etc/komodo}
            PERIPHERY_PASSKEYS: ${KOMODO_PASSKEY}
            PERIPHERY_DISABLE_TERMINALS: ${PERIPHERY_DISABLE_TERMINALS:-true}
            PERIPHERY_DISABLE_CONTAINER_TERMINALS: ${PERIPHERY_DISABLE_CONTAINER_TERMINALS:-true}
            PERIPHERY_STATS_POLLING_RATE: ${PERIPHERY_STATS_POLLING_RATE:-5-sec}
            PERIPHERY_CONTAINER_STATS_POLLING_RATE: ${PERIPHERY_CONTAINER_STATS_POLLING_RATE:-30-sec}
            PERIPHERY_INCLUDE_DISK_MOUNTS: ${PERIPHERY_INCLUDE_DISK_MOUNTS:-/etc/hostname}
            PERIPHERY_LOGGING_LEVEL: ${PERIPHERY_LOGGING_LEVEL:-info}
            PERIPHERY_LOGGING_STDIO: ${PERIPHERY_LOGGING_STDIO:-standard}
            PERIPHERY_LOGGING_PRETTY: ${PERIPHERY_LOGGING_PRETTY:-false}
            PERIPHERY_PRETTY_STARTUP_CONFIG: ${PERIPHERY_PRETTY_STARTUP_CONFIG:-false}
        ports:
            - ${PERIPHERY_PUBLISH_IP}:${PERIPHERY_PORT:-8120}:${PERIPHERY_PORT:-8120}
        volumes:
            - keys:/config/keys
            - /var/run/docker.sock:/var/run/docker.sock
            - /proc:/proc
            - ${PERIPHERY_ROOT_DIRECTORY:-/etc/komodo}:${PERIPHERY_ROOT_DIRECTORY:-/etc/komodo}
        networks:
            - reputo
YAML

cp "$ENV_FILE" "$tmp_env"

log "installing compose and env under ${INSTALL_DIR}"
run_root install -d -m 0755 "$INSTALL_DIR"
run_root install -d -m 0755 "$PERIPHERY_ROOT_DIRECTORY_VALUE"
run_root install -m 0644 "$tmp_compose" "$COMPOSE_FILE"
run_root install -m 0600 "$tmp_env" "$INSTALLED_ENV_FILE"

if [ "$DRY_RUN" -eq 1 ]; then
    log "dry run complete"
    exit 0
fi

if ! "${DOCKER[@]}" network inspect "$PERIPHERY_NETWORK_VALUE" >/dev/null 2>&1; then
    log "creating docker network ${PERIPHERY_NETWORK_VALUE}"
    "${DOCKER[@]}" network create "$PERIPHERY_NETWORK_VALUE" >/dev/null
fi

log "validating compose configuration"
"${DOCKER[@]}" compose \
    -f "$COMPOSE_FILE" \
    --env-file "$INSTALLED_ENV_FILE" \
    config >/dev/null

if [ "$PULL" -eq 1 ]; then
    log "pulling Periphery image"
    "${DOCKER[@]}" compose \
        -f "$COMPOSE_FILE" \
        --env-file "$INSTALLED_ENV_FILE" \
        pull periphery
fi

if [ "$START" -eq 1 ]; then
    log "starting/updating Periphery"
    "${DOCKER[@]}" compose \
        -f "$COMPOSE_FILE" \
        --env-file "$INSTALLED_ENV_FILE" \
        up -d periphery

    log "container status"
    "${DOCKER[@]}" compose \
        -f "$COMPOSE_FILE" \
        --env-file "$INSTALLED_ENV_FILE" \
        ps periphery
fi

log "Periphery is installed on ${PUBLISH_IP}:${PERIPHERY_PORT_VALUE}"
log "Register this host in Komodo Core as a Server using http://${PUBLISH_IP}:${PERIPHERY_PORT_VALUE} when PERIPHERY_SSL_ENABLED=false."
