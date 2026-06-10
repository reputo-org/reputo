#!/usr/bin/env bash
# Print the Node version pinned in mise.toml — the single source of truth
# for CI runners and the Docker images (NODE_VERSION build arg).
set -euo pipefail

node_version="$(awk -F'"' '/^node[[:space:]]*=/ { print $2 }' mise.toml)"
if [ -z "$node_version" ]; then
    echo "Unable to read the node version from mise.toml" >&2
    exit 1
fi
printf '%s\n' "$node_version"
