import { AxiosError, type AxiosResponse } from "axios"
import { describe, expect, it } from "vitest"
import { extractApiStatus } from "../../../../src/lib/api/status"

describe("extractApiStatus", () => {
  it("returns the HTTP status from an axios error response", () => {
    const error = new AxiosError(
      "Conflict",
      "ERR_BAD_REQUEST",
      undefined,
      undefined,
      { status: 409 } as AxiosResponse
    )

    expect(extractApiStatus(error)).toBe(409)
  })

  it("returns undefined for axios network errors without a response", () => {
    const error = new AxiosError("network", "ERR_NETWORK")
    expect(extractApiStatus(error)).toBeUndefined()
  })

  it("returns undefined for non-axios errors", () => {
    expect(extractApiStatus(new Error("boom"))).toBeUndefined()
    expect(extractApiStatus("string error")).toBeUndefined()
    expect(extractApiStatus(null)).toBeUndefined()
  })
})
