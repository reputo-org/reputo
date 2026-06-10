#!/usr/bin/env bash
# Verify that a deploy actually landed: poll the API health endpoint until
# it reports the expected commit SHA, then check the UI answers with 200.
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

for _ in $(seq 1 30); do
    sleep 10
    deployed="$(curl --silent --max-time 10 "$health_url" | jq -r '.sha // empty' 2>/dev/null || true)"

    if [ "$deployed" = "$EXPECTED_SHA" ]; then
        echo "✅ API at ${BASE_URL} is serving commit ${EXPECTED_SHA}"

        ui_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 "${BASE_URL}/")"
        if [ "$ui_status" = "200" ]; then
            echo "✅ UI at ${BASE_URL} responded with HTTP 200"
            exit 0
        fi
        echo "UI at ${BASE_URL} responded with HTTP ${ui_status}" >&2
        exit 1
    fi

    echo "API currently serving: ${deployed:-unreachable}"
done

echo "Timed out: ${health_url} never reported commit ${EXPECTED_SHA}" >&2
exit 1
