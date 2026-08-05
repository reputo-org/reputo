// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PresetDetailsDialog } from "@/components/app/presets/preset-details-dialog"
import type { AlgorithmPresetResponseDto } from "@/lib/api/types"

vi.mock("@/components/app/file-display", () => ({
  FileDisplay: ({
    label,
    storageKey,
  }: {
    label: string
    storageKey: string
  }) => (
    <div data-testid="file-display">
      {label}: {storageKey}
    </div>
  ),
}))

const customScorePreset: AlgorithmPresetResponseDto = {
  _id: "preset-1",
  key: "custom_score",
  version: "1.0.0",
  name: "Token + contribution",
  description: "Two children, 3:1",
  createdAt: "2026-07-13T10:00:00.000Z",
  updatedAt: "2026-07-13T10:00:00.000Z",
  inputs: [
    {
      key: "sub_algorithms",
      value: [
        {
          algorithm_key: "token_value_over_time",
          algorithm_version: "1.0.0",
          weight: 3,
          inputs: [
            { key: "maturation_threshold_days", value: 90 },
            {
              key: "selected_resources",
              value: [{ chain: "ethereum", resource_key: "fet_token" }],
            },
          ],
        },
        {
          algorithm_key: "voting_engagement",
          algorithm_version: "1.0.0",
          weight: 1,
          inputs: [
            { key: "votes", value: "uploads/e2e/votes.csv" },
            {
              key: "wallet_collections",
              value: "uploads/e2e/wallet_collections.csv",
            },
          ],
        },
      ],
    },
  ],
}

function renderDialog(preset: AlgorithmPresetResponseDto) {
  return render(
    <PresetDetailsDialog isOpen onClose={() => {}} preset={preset} />
  )
}

describe("PresetDetailsDialog", () => {
  it("renders each child algorithm with its name, weight and share", () => {
    renderDialog(customScorePreset)

    expect(screen.getByText("Child algorithms")).toBeInTheDocument()
    expect(screen.getByText("Token Value Over Time")).toBeInTheDocument()
    expect(screen.getByText("Voting Engagement")).toBeInTheDocument()
    expect(screen.getByText("75%")).toBeInTheDocument()
    expect(screen.getByText("25%")).toBeInTheDocument()
  })

  it("labels child inputs from the child definition instead of printing objects", () => {
    const { container } = renderDialog(customScorePreset)

    expect(container.textContent).not.toContain("[object Object]")
    expect(screen.getByText("Maturation period (days)")).toBeInTheDocument()
    expect(screen.getByText("90")).toBeInTheDocument()
    expect(screen.getByText("Token resources")).toBeInTheDocument()

    const files = screen.getAllByTestId("file-display")
    expect(files.map((node) => node.textContent)).toEqual([
      "Vote history (CSV): uploads/e2e/votes.csv",
      "Wallet collections (CSV): uploads/e2e/wallet_collections.csv",
    ])
  })

  it("resolves a child resource selection against the child's catalog", () => {
    renderDialog(customScorePreset)

    const resources = screen.getByText("Token resources").parentElement
    expect(resources).not.toBeNull()
    expect(within(resources as HTMLElement).getByText("Ethereum")).toBeVisible()
    expect(within(resources as HTMLElement).getByText("FET")).toBeVisible()
  })

  it("falls back to a title-cased label for inputs the definition dropped", () => {
    renderDialog({
      ...customScorePreset,
      inputs: [{ key: "missing_score_strategy", value: "zero" }],
    })

    expect(screen.getByText("Missing Score Strategy")).toBeInTheDocument()
    expect(screen.getByText("zero")).toBeInTheDocument()
  })

  it("shows a dash for an empty value", () => {
    renderDialog({
      ...customScorePreset,
      inputs: [{ key: "sub_algorithms", value: [] }],
    })

    expect(screen.getByText("—")).toBeInTheDocument()
  })
})
