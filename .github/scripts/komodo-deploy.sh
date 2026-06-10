#!/usr/bin/env bash
# Pin a Komodo stack to an immutable image tag and deploy it.
#
# 1. Sets the Komodo Variable $VARIABLE_NAME to $IMAGE_TAG (the stack's
#    compose file resolves IMAGE_TAG from this variable).
# 2. Triggers DeployStack for $STACK_NAME through the Komodo API.
# 3. Polls the resulting Update until Komodo reports Complete, and fails
#    the job if the deploy was not successful.
#
# Required environment:
#   KOMODO_URL          e.g. https://komodo.logid.xyz
#   KOMODO_API_KEY      Komodo API key
#   KOMODO_API_SECRET   Komodo API secret
#   VARIABLE_NAME       e.g. STAGING_IMAGE_TAG
#   IMAGE_TAG           e.g. sha-<commit>
#   STACK_NAME          e.g. reputo-apps-staging
set -euo pipefail

for required in KOMODO_URL KOMODO_API_KEY KOMODO_API_SECRET VARIABLE_NAME IMAGE_TAG STACK_NAME; do
    if [ -z "${!required:-}" ]; then
        echo "$required is required" >&2
        exit 1
    fi
done

komodo() {
    local path="$1" body="$2"
    curl --fail-with-body --show-error --silent \
        --request POST "${KOMODO_URL}${path}" \
        --header 'Content-Type: application/json' \
        --header "X-Api-Key: ${KOMODO_API_KEY}" \
        --header "X-Api-Secret: ${KOMODO_API_SECRET}" \
        --data "$body"
}

echo "Pinning ${VARIABLE_NAME} to ${IMAGE_TAG}"
if ! komodo /write "$(jq -cn --arg name "$VARIABLE_NAME" --arg value "$IMAGE_TAG" \
    '{ type: "UpdateVariableValue", params: { name: $name, value: $value } }')" >/dev/null; then
    echo "Failed to update the Komodo variable ${VARIABLE_NAME}." >&2
    echo "401: check KOMODO_API_KEY / KOMODO_API_SECRET in the GitHub environment." >&2
    echo "Other errors: check the variable exists in Komodo (Settings > Variables)" >&2
    echo "and that the API key's user may write variables and deploy stacks." >&2
    exit 1
fi

echo "Deploying stack ${STACK_NAME}"
update="$(komodo /execute "$(jq -cn --arg stack "$STACK_NAME" \
    '{ type: "DeployStack", params: { stack: $stack } }')")"
update_id="$(jq -r '._id."$oid" // empty' <<<"$update")"

if [ -z "$update_id" ]; then
    echo "Komodo did not return an update id. Response:" >&2
    echo "$update" >&2
    exit 1
fi

echo "Waiting for Komodo update ${update_id} to complete"
for _ in $(seq 1 90); do
    sleep 5

    if ! update="$(komodo /read "$(jq -cn --arg id "$update_id" \
        '{ type: "GetUpdate", params: { id: $id } }')")"; then
        echo "Komodo poll request failed — retrying"
        continue
    fi
    status="$(jq -r '.status // empty' <<<"$update" 2>/dev/null || true)"

    if [ "$status" = "Complete" ]; then
        if [ "$(jq -r '.success' <<<"$update")" = "true" ]; then
            echo "Komodo deployed ${STACK_NAME} with ${VARIABLE_NAME}=${IMAGE_TAG}"
            exit 0
        fi
        echo "Komodo reported a failed deploy for ${STACK_NAME}:" >&2
        jq '.logs // .' <<<"$update" >&2
        exit 1
    fi
    echo "Komodo update status: ${status:-unknown}"
done

echo "Timed out waiting for Komodo update ${update_id}" >&2
exit 1
