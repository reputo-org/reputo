import { describe, expect, it, vi } from "vitest"
import {
  applyFieldErrors,
  resolveErrorPath,
} from "@/components/app/presets/composer/composer-errors"

const formKeys = new Set(["sub_algorithms", "name", "description"])

const values = {
  sub_algorithms: [
    {
      algorithm_key: "voting_engagement",
      inputs: [
        { key: "votes", value: "" },
        { key: "wallet_collections", value: "" },
      ],
    },
  ],
}

describe("resolveErrorPath", () => {
  it("passes through top-level form fields", () => {
    expect(resolveErrorPath("name", values, formKeys)).toBe("name")
  })

  it("maps a child input key to its positional form path", () => {
    expect(
      resolveErrorPath(
        "sub_algorithms.0.inputs.wallet_collections",
        values,
        formKeys
      )
    ).toBe("sub_algorithms.0.inputs.1.value")
  })

  it("keeps row-level paths that are already form paths", () => {
    expect(
      resolveErrorPath("sub_algorithms.0.algorithm_key", values, formKeys)
    ).toBe("sub_algorithms.0.algorithm_key")
  })

  it("returns null when nothing can be resolved", () => {
    expect(resolveErrorPath("_general", values, formKeys)).toBeNull()
    expect(resolveErrorPath("unknown_input", values, formKeys)).toBeNull()
    expect(
      resolveErrorPath("sub_algorithms.0.inputs.not_a_key", values, formKeys)
    ).toBeNull()
    expect(
      resolveErrorPath("sub_algorithms.9.inputs.votes", values, formKeys)
    ).toBeNull()
  })
})

describe("applyFieldErrors", () => {
  it("routes child errors inline and leaves the rest for the alert", () => {
    const setError = vi.fn()

    const general = applyFieldErrors(
      [
        {
          field: "sub_algorithms.0.inputs.votes",
          message: "Vote History (CSV) is required",
        },
        { field: "name", message: "Name is taken" },
        { field: "_general", message: "Something exploded" },
        { field: "mystery_field", message: "Unmapped" },
      ],
      { formKeys, setError, values }
    )

    expect(setError).toHaveBeenCalledWith("sub_algorithms.0.inputs.0.value", {
      type: "server",
      message: "Vote History (CSV) is required",
    })
    expect(setError).toHaveBeenCalledWith("name", {
      type: "server",
      message: "Name is taken",
    })
    expect(general).toEqual(["Something exploded", "Unmapped"])
  })

  it("deduplicates general messages", () => {
    const setError = vi.fn()

    expect(
      applyFieldErrors(
        [
          { field: "_general", message: "Boom" },
          { field: "_general", message: "Boom" },
        ],
        { formKeys, setError, values }
      )
    ).toEqual(["Boom"])
  })
})
