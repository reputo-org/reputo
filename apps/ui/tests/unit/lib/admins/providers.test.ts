import { describe, expect, it } from "vitest"
import { getProviderLabel } from "../../../../src/lib/admins/providers"

describe("getProviderLabel", () => {
  it("returns the configured label for a known provider", () => {
    expect(getProviderLabel("deep-id")).toBe("DeepID")
  })

  it("falls back to the provider id when no label is configured", () => {
    expect(getProviderLabel("unknown" as never)).toBe("unknown")
  })
})
