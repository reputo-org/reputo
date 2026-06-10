#!/usr/bin/env bash
# Verify that a deploy actually landed: poll the API health endpoint until
# it reports the expected commit SHA, then check the UI is serving.
#
# Required environment:
#   BASE_URL       e.g. https://staging.logid.xyz
#   EXPECTED_SHA   full git commit SHA the deploy should be serving
set -euo pipefail

for required in BASE_URL EXPECTED_SHA; do
    if [ -z "${!required:-}" ]; then
        echo "$required is required" >&2
        exit 1
    fi
done

health_url="${BASE_URL}/api/v1/health"
echo "Waiting for ${health_url} to serve commit ${EXPECTED_SHA}"

api_ok=""
for _ in $(seq 1 30); do
    sleep 10

    if [ -z "$api_ok" ]; then
        deployed="$(curl --silent --max-time 10 "$health_url" | jq -r '.sha // empty' 2>/dev/null || true)"
        if [ "$deployed" != "$EXPECTED_SHA" ]; then
            echo "API currently serving: ${deployed:-unreachable}"
            continue
        fi
        echo "✅ API at ${BASE_URL} is serving commit ${EXPECTED_SHA}"
        api_ok=1
    fi

    # Any 2xx/3xx counts as alive: / redirects (307 to /dashboard), and
    # following it could bounce to the external OAuth issuer.
    ui_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 "${BASE_URL}/" || true)"
    case "$ui_status" in
        2*|3*)
            echo "✅ UI at ${BASE_URL} responded with HTTP ${ui_status}"
            exit 0
            ;;
    esac
    echo "UI responded with HTTP ${ui_status:-000} — retrying"
done

if [ -z "$api_ok" ]; then
    echo "Timed out: ${health_url} never reported commit ${EXPECTED_SHA}" >&2
else
    echo "Timed out: UI at ${BASE_URL} never answered with a 2xx/3xx" >&2
fi
exit 1
