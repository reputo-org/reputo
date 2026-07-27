import { describe, expect, it } from "vitest"
import {
  buildDisableReasons,
  computeFieldReadiness,
} from "@/components/app/presets/composer/composer-readiness"
import type { FormInput } from "@/core/schema-builder"

const textInput: FormInput = { key: "name", label: "Preset Name", type: "text" }
const optionalInput: FormInput = {
  key: "notes",
  label: "Notes",
  type: "text",
  required: false,
}
const csvInput: FormInput = { key: "votes", label: "Votes CSV", type: "csv" }
const arrayInput: FormInput = {
  key: "selected_resources",
  label: "Token Resources",
  type: "array",
  minItems: 2,
}
const subAlgorithmInput: FormInput = {
  key: "sub_algorithms",
  label: "Sub-Algorithms",
  type: "sub_algorithm",
  minItems: 1,
}

describe("computeFieldReadiness", () => {
  it("marks filled required fields done and empty ones missing", () => {
    const readiness = computeFieldReadiness(
      [textInput, csvInput],
      { name: "My preset", votes: "" },
      {}
    )

    expect(readiness).toEqual([
      { key: "name", label: "Preset Name", status: "done" },
      { key: "votes", label: "Votes CSV", status: "missing" },
    ])
  })

  it("skips optional fields unless they carry an error", () => {
    expect(computeFieldReadiness([optionalInput], { notes: "" }, {})).toEqual(
      []
    )

    expect(
      computeFieldReadiness([optionalInput], { notes: "x" }, {
        notes: { type: "server", message: "bad" },
      } as never)
    ).toEqual([{ key: "notes", label: "Notes", status: "error" }])
  })

  it("treats an in-flight File as not ready for csv fields", () => {
    const file = new File(["a,b"], "votes.csv", { type: "text/csv" })
    expect(computeFieldReadiness([csvInput], { votes: file }, {})).toEqual([
      { key: "votes", label: "Votes CSV", status: "missing" },
    ])

    expect(
      computeFieldReadiness([csvInput], { votes: "uploads/votes.csv" }, {})
    ).toEqual([{ key: "votes", label: "Votes CSV", status: "done" }])
  })

  it("enforces array minItems", () => {
    expect(
      computeFieldReadiness(
        [arrayInput],
        { selected_resources: [{ chain: "ethereum" }] },
        {}
      )[0]?.status
    ).toBe("missing")

    expect(
      computeFieldReadiness(
        [arrayInput],
        { selected_resources: [{ chain: "ethereum" }, { chain: "cardano" }] },
        {}
      )[0]?.status
    ).toBe("done")
  })

  it("requires assigned sub-algorithm entries", () => {
    expect(
      computeFieldReadiness([subAlgorithmInput], { sub_algorithms: [] }, {})[0]
        ?.status
    ).toBe("missing")

    expect(
      computeFieldReadiness(
        [subAlgorithmInput],
        { sub_algorithms: [{ algorithm_key: "" }] },
        {}
      )[0]?.status
    ).toBe("missing")
  })

  it("requires every child input of a composed algorithm", () => {
    // voting_engagement needs two CSVs; the composer seeds them empty.
    const emptyChild = {
      sub_algorithms: [
        {
          algorithm_key: "voting_engagement",
          algorithm_version: "1.0.0",
          weight: 1,
          inputs: [
            { key: "votes", value: "" },
            { key: "wallet_collections", value: "" },
          ],
        },
      ],
    }
    expect(
      computeFieldReadiness([subAlgorithmInput], emptyChild, {})[0]?.status
    ).toBe("missing")

    const oneFileMissing = {
      sub_algorithms: [
        {
          algorithm_key: "voting_engagement",
          algorithm_version: "1.0.0",
          weight: 1,
          inputs: [
            { key: "votes", value: "uploads/votes.csv" },
            { key: "wallet_collections", value: "" },
          ],
        },
      ],
    }
    expect(
      computeFieldReadiness([subAlgorithmInput], oneFileMissing, {})[0]?.status
    ).toBe("missing")

    const complete = {
      sub_algorithms: [
        {
          algorithm_key: "voting_engagement",
          algorithm_version: "1.0.0",
          weight: 1,
          inputs: [
            { key: "votes", value: "uploads/votes.csv" },
            { key: "wallet_collections", value: "uploads/wallets.csv" },
          ],
        },
      ],
    }
    expect(
      computeFieldReadiness([subAlgorithmInput], complete, {})[0]?.status
    ).toBe("done")
  })

  it("treats a child with defaulted inputs as ready", () => {
    // proposal_engagement inputs all carry registry defaults.
    const ready = {
      sub_algorithms: [
        {
          algorithm_key: "proposal_engagement",
          algorithm_version: "1.0.0",
          weight: 1,
          inputs: [
            { key: "funded_concluded_reward_weight", value: 1 },
            { key: "unfunded_penalty_weight", value: 1 },
            { key: "engagement_window_months", value: 48 },
            { key: "monthly_decay_rate_percent", value: 0 },
          ],
        },
      ],
    }

    expect(
      computeFieldReadiness([subAlgorithmInput], ready, {})[0]?.status
    ).toBe("done")
  })

  it("lets an error win over a filled value", () => {
    expect(
      computeFieldReadiness([textInput], { name: "ok" }, {
        name: { type: "server", message: "taken" },
      } as never)[0]?.status
    ).toBe("error")
  })
})

describe("buildDisableReasons", () => {
  it("lists uploads, missing fields, and errors", () => {
    expect(
      buildDisableReasons({
        readiness: [
          { key: "a", label: "Field A", status: "missing" },
          { key: "b", label: "Field B", status: "error" },
          { key: "c", label: "Field C", status: "done" },
        ],
        uploadingLabels: ["Votes CSV"],
        isSubmitting: false,
      })
    ).toEqual([
      "Uploading Votes CSV…",
      "Field A is missing",
      "Field B needs attention",
    ])
  })

  it("caps the list and reports the hidden count", () => {
    const readiness = Array.from({ length: 6 }, (_, index) => ({
      key: `k${index}`,
      label: `Field ${index}`,
      status: "missing" as const,
    }))

    const reasons = buildDisableReasons({
      readiness,
      uploadingLabels: [],
      isSubmitting: false,
    })

    expect(reasons).toHaveLength(5)
    expect(reasons[4]).toBe("…and 2 more")
  })

  it("returns nothing while submitting", () => {
    expect(
      buildDisableReasons({
        readiness: [{ key: "a", label: "Field A", status: "missing" }],
        uploadingLabels: [],
        isSubmitting: true,
      })
    ).toEqual([])
  })
})
