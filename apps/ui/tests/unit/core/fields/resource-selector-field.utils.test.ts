import type { ResourceCatalog } from "@reputo/reputation-algorithms"
import { describe, expect, it } from "vitest"
import {
  buildResourceSelectorPanels,
  formatShortIdentifier,
  sortResourceSelections,
} from "../../../../src/core/fields/resource-selector-field.utils"

const catalog: ResourceCatalog = {
  chains: [
    {
      key: "cardano",
      label: "Cardano",
      resources: [
        {
          key: "fet_token",
          label: "FET",
          kind: "token",
          identifier:
            "e824c0011176f0926ad51f492bcc63ac6a03a589653520839dc7e3d9",
          tokenIdentifier:
            "e824c0011176f0926ad51f492bcc63ac6a03a589653520839dc7e3d9",
          tokenKey: "fet",
        },
      ],
    },
    {
      key: "ethereum",
      label: "Ethereum",
      resources: [
        {
          key: "fet_token",
          label: "FET",
          kind: "token",
          identifier: "0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85",
          tokenIdentifier: "0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85",
          tokenKey: "fet",
          explorerUrl:
            "https://etherscan.io/token/0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85",
          explorerLabel: "Etherscan",
        },
        {
          key: "fet_staking_1",
          label: "FET Staking",
          kind: "contract",
          identifier: "0xCB85b101C4822A4E3ABCa20e57f1DFf0E2673475",
          tokenIdentifier: "0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85",
          tokenKey: "fet",
        },
      ],
    },
  ],
}

describe("resource-selector-field utils", () => {
  it("preserves catalog order when sorting selections", () => {
    const sorted = sortResourceSelections(
      [
        { chain: "ethereum", resource_key: "fet_staking_1" },
        { chain: "cardano", resource_key: "fet_token" },
      ],
      catalog
    )

    expect(sorted).toEqual([
      { chain: "cardano", resource_key: "fet_token" },
      { chain: "ethereum", resource_key: "fet_staking_1" },
    ])
  })

  it("builds explorer labels when present and unavailable fallback when missing", () => {
    const panels = buildResourceSelectorPanels({
      catalog,
      selections: [{ chain: "ethereum", resource_key: "fet_staking_1" }],
      getChainIconUrl: (chainKey) => `https://icons.test/${chainKey}.png`,
    })

    expect(panels.map((panel) => panel.key)).toEqual(["cardano", "ethereum"])
    expect(panels[1]?.rows.map((row) => row.resourceKey)).toEqual([
      "fet_token",
      "fet_staking_1",
    ])
    expect(panels[1]?.rows[0]).toMatchObject({
      selected: false,
      iconUrl: "https://icons.test/ethereum.png",
      explorer: {
        href: "https://etherscan.io/token/0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85",
        label: "Etherscan",
      },
    })
    expect(panels[1]?.rows[1]).toMatchObject({
      selected: true,
      explorer: {
        href: undefined,
        label: "Explorer",
      },
    })
  })

  it("shortens identifiers for display", () => {
    expect(
      formatShortIdentifier("0xCB85b101C4822A4E3ABCa20e57f1DFf0E2673475")
    ).toBe("0xCB85…3475")
    expect(
      formatShortIdentifier(
        "e824c0011176f0926ad51f492bcc63ac6a03a589653520839dc7e3d9464554"
      )
    ).toBe("e824c001…4554")
    expect(formatShortIdentifier("afet")).toBe("afet")
  })

  it("adds short identifiers to rows and strips label suffixes that repeat them", () => {
    const suffixCatalog: ResourceCatalog = {
      chains: [
        {
          key: "ethereum",
          label: "Ethereum",
          resources: [
            {
              key: "fet_staking_1",
              label: "FET Staking · 0xCB85…3475",
              kind: "contract",
              identifier: "0xCB85b101C4822A4E3ABCa20e57f1DFf0E2673475",
              tokenIdentifier: "0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85",
              tokenKey: "fet",
            },
          ],
        },
      ],
    }

    const panels = buildResourceSelectorPanels({
      catalog: suffixCatalog,
      selections: [],
    })

    expect(panels[0]?.rows[0]).toMatchObject({
      label: "FET Staking",
      shortIdentifier: "0xCB85…3475",
    })
  })
})
