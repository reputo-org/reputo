import { describe, expect, it } from "vitest"
import { buildPresetInputsFromForm } from "../../../../../src/components/app/presets/preset-payload"

describe("preset payload serialization", () => {
  it("serializes nested custom_score entries with explicit numeric weights and blank upload placeholders", () => {
    const walletsFile = new File(["{}"], "wallets.json", {
      type: "application/json",
    })
    const votesFile = new File(["id\n1\n"], "votes.csv", {
      type: "text/csv",
    })

    expect(
      buildPresetInputsFromForm({
        algorithmInputs: [
          { key: "wallets", type: "json" },
          { key: "sub_algorithms", type: "sub_algorithm" },
          { key: "lookback_window_days", type: "number" },
          { key: "normalization_method", type: "string" },
        ],
        data: {
          wallets: walletsFile,
          sub_algorithms: [
            {
              algorithm_key: "voting_engagement",
              algorithm_version: "1.0.0",
              weight: "1,5",
              inputs: [
                { key: "votes", value: votesFile },
                { key: "minimum_votes", value: "2" },
              ],
            },
          ],
          lookback_window_days: "90,5",
          normalization_method: "none",
        },
      })
    ).toEqual([
      { key: "wallets", value: "" },
      {
        key: "sub_algorithms",
        value: [
          {
            algorithm_key: "voting_engagement",
            algorithm_version: "1.0.0",
            weight: 1.5,
            inputs: [
              { key: "votes", value: "" },
              { key: "minimum_votes", value: "2" },
            ],
          },
        ],
      },
      { key: "lookback_window_days", value: 90.5 },
      { key: "normalization_method", value: "none" },
    ])
  })

  it("reuses persisted values for unchanged edit fields", () => {
    expect(
      buildPresetInputsFromForm({
        algorithmInputs: [
          { key: "lookback_window_days", type: "number" },
          { key: "selected_resources", type: "array" },
          { key: "sub_algorithms", type: "sub_algorithm" },
        ],
        data: {},
        existingInputs: [
          { key: "lookback_window_days", value: "30" },
          {
            key: "selected_resources",
            value: [{ chain: "ethereum", resource_key: "fet_token" }],
          },
          {
            key: "sub_algorithms",
            value: [
              {
                algorithm_key: "proposal_engagement",
                algorithm_version: "1.0.0",
                weight: 2,
                inputs: [],
              },
            ],
          },
        ],
      })
    ).toEqual([
      { key: "lookback_window_days", value: 30 },
      {
        key: "selected_resources",
        value: [{ chain: "ethereum", resource_key: "fet_token" }],
      },
      {
        key: "sub_algorithms",
        value: [
          {
            algorithm_key: "proposal_engagement",
            algorithm_version: "1.0.0",
            weight: 2,
            inputs: [],
          },
        ],
      },
    ])
  })
})
