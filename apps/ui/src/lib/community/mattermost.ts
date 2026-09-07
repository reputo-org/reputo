import axios from "axios"

/**
 * Reason-code → prose mapping for the Mattermost connect dialog.
 *
 * The API answers a failed validate/connect with a machine-readable reason
 * code in the error body — never an upstream response. Unknown or missing
 * codes fall through to a generic sentence so the dialog never renders a raw
 * server payload.
 */
const CONNECT_ERROR_COPY: Record<string, string> = {
  outbound_policy:
    "Reputo can connect only to public HTTPS server addresses. Check the URL.",
  auth_failed: "Mattermost rejected the token. Check it and try again.",
  team_not_found:
    "The bot is not a member of that team. Select one of its teams.",
  permission_denied:
    "The bot cannot read any channel in this team. Add it to the channels Reputo should use, then try again.",
  not_found: "That does not look like a Mattermost server. Check the URL.",
  contract_violation:
    "That does not look like a Mattermost server. Check the URL.",
  rate_limited:
    "The server has limited Reputo's requests. Try again in a few minutes.",
  network_error: "The server could not be reached. Check the URL.",
  upstream_error: "The server answered with an error. Try again shortly.",
}

const GENERIC_CONNECT_ERROR =
  "Could not connect to the server. Check the URL and bot token, then try again."

/**
 * Copy for a failed validate/connect call. Reads the reason code out of the
 * thrown axios error; anything unexpected gets the generic sentence.
 */
export function describeMattermostConnectError(error: unknown): string {
  if (!axios.isAxiosError(error)) return GENERIC_CONNECT_ERROR

  const message = (error.response?.data as { message?: unknown } | undefined)
    ?.message
  const code =
    typeof message === "string"
      ? message
      : (message as { message?: unknown } | undefined)?.message

  return typeof code === "string"
    ? (CONNECT_ERROR_COPY[code] ?? GENERIC_CONNECT_ERROR)
    : GENERIC_CONNECT_ERROR
}

/**
 * Server origin of a Mattermost connection id (`{origin}/{teamId}`), used to
 * prefill the dialog on reconnect. Undefined when the id is not in that form.
 */
export function mattermostServerUrlFromExternalId(
  externalId: string
): string | undefined {
  const separator = externalId.lastIndexOf("/")
  const origin = separator > 0 ? externalId.slice(0, separator) : ""
  return /^https?:\/\/[^/]+$/.test(origin) ? origin : undefined
}
