import { AxiosError, AxiosHeaders } from "axios"
import { describe, expect, it } from "vitest"
import {
  describeMattermostConnectError,
  mattermostServerUrlFromExternalId,
} from "@/lib/community/mattermost"

function apiError(message: unknown): AxiosError {
  const headers = new AxiosHeaders()
  const config = { headers }
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", config, null, {
    status: 400,
    statusText: "Bad Request",
    headers,
    config,
    data: { statusCode: 400, message },
  })
}

describe("describeMattermostConnectError", () => {
  it("maps every reason code the API raises to prose", () => {
    expect(describeMattermostConnectError(apiError("outbound_policy"))).toMatch(
      /public HTTPS hosts/
    )
    expect(describeMattermostConnectError(apiError("auth_failed"))).toMatch(
      /rejected the token/
    )
    expect(describeMattermostConnectError(apiError("team_not_found"))).toMatch(
      /not a member of that team/
    )
  })

  it("reads a nested validation-error message shape too", () => {
    expect(
      describeMattermostConnectError(apiError({ message: "auth_failed" }))
    ).toMatch(/rejected the token/)
  })

  it("falls back to the generic sentence and never renders a raw payload", () => {
    const raw = "<html>upstream said something</html>"
    for (const error of [
      apiError(raw),
      apiError(undefined),
      new Error("boom"),
      undefined,
    ]) {
      const copy = describeMattermostConnectError(error)
      expect(copy).toBe(
        "Could not connect to the server. Check the URL and token."
      )
      expect(copy).not.toContain("upstream")
    }
  })
})

describe("mattermostServerUrlFromExternalId", () => {
  it("recovers the origin, scheme and port included", () => {
    expect(
      mattermostServerUrlFromExternalId("https://chat.example.com:8065/team-1")
    ).toBe("https://chat.example.com:8065")
    expect(mattermostServerUrlFromExternalId("http://mattermost:8065/t")).toBe(
      "http://mattermost:8065"
    )
  })

  it("returns undefined for ids that are not {origin}/{teamId}", () => {
    expect(mattermostServerUrlFromExternalId("974492421130127923")).toBe(
      undefined
    )
    expect(mattermostServerUrlFromExternalId("")).toBe(undefined)
  })
})
