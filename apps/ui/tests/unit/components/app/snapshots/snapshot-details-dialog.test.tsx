// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SnapshotDetailsDialog } from "@/components/app/snapshots/snapshot-details-dialog"
import type { SnapshotResponseDto } from "@/lib/api/types"

vi.mock("@/components/app/file-display", () => ({
  FileDisplay: ({ label }: { label: string }) => (
    <div data-testid="file-display">{label}</div>
  ),
}))

const frozenPreset = {
  _id: "frozen-1",
  key: "token_value_over_time",
  version: "1.0.0",
  name: "REAL S5",
  inputs: [
    { key: "maturation_threshold_days", value: 90 },
    {
      key: "selected_resources",
      value: [{ chain: "ethereum", resource_key: "fet_token" }],
    },
  ],
  createdAt: "2026-07-08T12:00:00.000Z",
  updatedAt: "2026-07-08T12:00:00.000Z",
}

const snapshot: SnapshotResponseDto = {
  _id: "snapshot-1",
  status: "completed",
  algorithmPreset: "preset-1",
  algorithmPresetFrozen: frozenPreset,
  outputs: {
    token_value_over_time: "snapshots/1/token_value_over_time.csv",
    token_value_over_time_details:
      "snapshots/1/token_value_over_time_details.json",
  },
  createdAt: "2026-07-08T12:00:00.000Z",
  updatedAt: "2026-07-08T12:02:00.000Z",
}

describe("SnapshotDetailsDialog", () => {
  it("labels outputs from the frozen preset's definition", () => {
    render(
      <SnapshotDetailsDialog isOpen onClose={() => {}} snapshot={snapshot} />
    )

    expect(screen.getByText("Token value over time (CSV)")).toBeInTheDocument()
    expect(
      screen.getByText("Token value over time details (JSON)")
    ).toBeInTheDocument()
  })

  it("title-cases outputs the definition no longer declares", () => {
    render(
      <SnapshotDetailsDialog
        isOpen
        onClose={() => {}}
        snapshot={{
          ...snapshot,
          outputs: { composite_score: "snapshots/1/composite_score.csv" },
        }}
      />
    )

    expect(screen.getByText("Composite Score")).toBeInTheDocument()
  })

  it("shows the frozen inputs the run actually used", () => {
    const { container } = render(
      <SnapshotDetailsDialog isOpen onClose={() => {}} snapshot={snapshot} />
    )

    expect(screen.getByText("Inputs")).toBeInTheDocument()
    expect(screen.getByText("Maturation period (days)")).toBeInTheDocument()
    expect(screen.getByText("90")).toBeInTheDocument()
    expect(screen.getByText("Token resources")).toBeInTheDocument()
    expect(screen.getByText("FET")).toBeInTheDocument()
    expect(container.textContent).not.toContain("[object Object]")
  })

  it("names the algorithm the run was frozen against", () => {
    render(
      <SnapshotDetailsDialog isOpen onClose={() => {}} snapshot={snapshot} />
    )

    expect(screen.getByText("Token Value Over Time v1.0.0")).toBeInTheDocument()
  })

  it("omits the inputs section when the frozen preset has none", () => {
    render(
      <SnapshotDetailsDialog
        isOpen
        onClose={() => {}}
        snapshot={{
          ...snapshot,
          algorithmPresetFrozen: { ...frozenPreset, inputs: [] },
        }}
      />
    )

    expect(screen.queryByText("Inputs")).not.toBeInTheDocument()
  })
})
