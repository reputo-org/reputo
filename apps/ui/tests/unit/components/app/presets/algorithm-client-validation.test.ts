import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { createDownload } = vi.hoisted(() => ({
  createDownload: vi.fn(),
}))

vi.mock("@/lib/api/services", () => ({
  storageApi: {
    createDownload,
  },
}))

import { validateAlgorithmPresetClient } from "../../../../../src/components/app/presets/algorithm-client-validation"

describe("algorithm client validation", () => {
  beforeEach(() => {
    createDownload.mockReset()
    vi.stubGlobal("fetch", vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("surfaces a recreate message for stale selected_targets presets", async () => {
    await expect(
      validateAlgorithmPresetClient({
        key: "token_value_over_time",
        version: "1.0.0",
        inputs: [
          {
            key: "maturation_threshold_days",
            value: 90,
          },
          {
            key: "selected_targets",
            value: [
              {
                chain: "ethereum",
                target_identifier: "0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85",
              },
            ],
          },
        ],
      })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "selected_targets",
          message: expect.stringContaining("Recreate the preset"),
        }),
        expect.objectContaining({
          field: "selected_resources",
        }),
      ])
    )
  })
})
