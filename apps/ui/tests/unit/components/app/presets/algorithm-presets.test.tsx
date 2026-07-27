// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AlgorithmPresets } from "@/components/app/presets/algorithm-presets"
import type { Algorithm } from "@/core/algorithms"
import {
  useAlgorithmPresets,
  useCreateSnapshot,
  useDeleteAlgorithmPreset,
} from "@/lib/api/hooks"

const { pushMock, replaceMock, searchParamsRef } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams() },
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  usePathname: () => "/dashboard/algorithms/reputation_score",
  useSearchParams: () => searchParamsRef.current,
}))

vi.mock("@/lib/api/hooks", () => ({
  useAlgorithmPresets: vi.fn(),
  useDeleteAlgorithmPreset: vi.fn(),
  useCreateSnapshot: vi.fn(),
}))

vi.mock("@/components/app/presets/preset-delete-dialog", () => ({
  PresetDeleteDialog: () => null,
}))
vi.mock("@/components/app/presets/preset-details-dialog", () => ({
  PresetDetailsDialog: () => null,
}))

const mockUsePresets = vi.mocked(useAlgorithmPresets)
const mockUseCreateSnapshot = vi.mocked(useCreateSnapshot)
const mockUseDeletePreset = vi.mocked(useDeleteAlgorithmPreset)

const algo: Algorithm = {
  id: "reputation_score",
  title: "Reputation Score",
  category: "Engagement",
  summary: "Scores reputation.",
  description: "Scores reputation.",
  duration: "~2-5 min",
  inputSummary: "1 configurable input",
  level: "Beginner",
  kind: "standalone",
  inputs: [],
  dependencyLabels: [],
}

const preset = {
  _id: "p1",
  key: "reputation_score",
  name: "My Preset",
  description: "Scores wallets",
  version: "1.0.0",
  inputs: [{ name: "wallets" }],
  createdAt: "2024-01-15T00:00:00.000Z",
}

function mutationStub() {
  return {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    error: null,
  }
}

let createSnapshotMutateAsync: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  searchParamsRef.current = new URLSearchParams()

  mockUsePresets.mockReturnValue({
    data: { results: [preset] },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useAlgorithmPresets>)

  createSnapshotMutateAsync = vi.fn().mockResolvedValue(undefined)
  mockUseCreateSnapshot.mockReturnValue({
    mutateAsync: createSnapshotMutateAsync,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof useCreateSnapshot>)

  mockUseDeletePreset.mockReturnValue(
    mutationStub() as unknown as ReturnType<typeof useDeleteAlgorithmPreset>
  )
})

afterEach(() => {
  vi.useRealTimers()
})

describe("AlgorithmPresets", () => {
  it("renders a loading state while presets are fetching", () => {
    mockUsePresets.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof useAlgorithmPresets>)

    render(<AlgorithmPresets />)

    expect(screen.getByText("Loading presets")).toBeInTheDocument()
  })

  it("renders an error state when the query fails", () => {
    mockUsePresets.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
    } as unknown as ReturnType<typeof useAlgorithmPresets>)

    render(<AlgorithmPresets />)

    expect(screen.getByText("Could not load presets")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument()
  })

  it("renders an empty state that links to the composer", () => {
    mockUsePresets.mockReturnValue({
      data: { results: [] },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useAlgorithmPresets>)

    render(<AlgorithmPresets algo={algo} />)

    expect(screen.getByText("No presets yet")).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /create a preset/i })
    ).toHaveAttribute(
      "href",
      "/dashboard/algorithms/reputation_score/presets/new"
    )
  })

  it("links the header button to the composer route", () => {
    render(<AlgorithmPresets algo={algo} />)

    expect(screen.getByRole("link", { name: /new preset/i })).toHaveAttribute(
      "href",
      "/dashboard/algorithms/reputation_score/presets/new"
    )
  })

  it("renders a row per preset with its details", () => {
    render(<AlgorithmPresets algo={algo} />)

    expect(screen.getByText("My Preset")).toBeInTheDocument()
    expect(screen.getByText("Reputation Score")).toBeInTheDocument()
    expect(screen.getByText("1.0.0")).toBeInTheDocument()
    expect(screen.getByText("1 input")).toBeInTheDocument()
  })

  it("runs a preset only after the confirmation dialog is accepted", async () => {
    const user = userEvent.setup()
    render(<AlgorithmPresets algo={algo} />)

    await user.click(screen.getByRole("button", { name: /^run$/i }))
    expect(createSnapshotMutateAsync).not.toHaveBeenCalled()

    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent(/My Preset/)

    await user.click(within(dialog).getByRole("button", { name: /^run$/i }))

    await waitFor(() =>
      expect(createSnapshotMutateAsync).toHaveBeenCalledWith({
        algorithmPresetId: "p1",
        outputs: {},
      })
    )
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1))
    const url = String(pushMock.mock.calls[0][0])
    expect(url).toContain("tab=snapshots")
    expect(url).toContain("preset=p1")
  })

  it("exposes edit and duplicate links in the actions menu", async () => {
    const user = userEvent.setup()
    render(<AlgorithmPresets algo={algo} />)

    await user.click(screen.getByRole("button", { name: "Preset actions" }))

    const editLink = await screen.findByRole("menuitem", { name: /edit/i })
    expect(editLink).toHaveAttribute(
      "href",
      "/dashboard/algorithms/reputation_score/presets/p1/edit"
    )
    expect(
      screen.getByRole("menuitem", { name: /duplicate/i })
    ).toHaveAttribute(
      "href",
      "/dashboard/algorithms/reputation_score/presets/new?from=p1"
    )
  })

  it("navigates to snapshots from the actions menu without running", async () => {
    const user = userEvent.setup()
    render(<AlgorithmPresets algo={algo} />)

    await user.click(screen.getByRole("button", { name: "Preset actions" }))
    await user.click(
      await screen.findByRole("menuitem", { name: /view snapshots/i })
    )

    expect(createSnapshotMutateAsync).not.toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledTimes(1)
    const url = String(pushMock.mock.calls[0][0])
    expect(url).toContain("tab=snapshots")
    expect(url).toContain("preset=p1")
  })

  it("highlights a freshly created preset and strips the marker param", () => {
    vi.useFakeTimers()
    searchParamsRef.current = new URLSearchParams("tab=presets&created=p1")

    render(<AlgorithmPresets algo={algo} />)

    const row = screen.getByText("My Preset").closest("tr")
    expect(row?.className).toContain("bg-primary/5")

    act(() => {
      vi.advanceTimersByTime(4001)
    })

    expect(replaceMock).toHaveBeenCalledTimes(1)
    const url = String(replaceMock.mock.calls[0][0])
    expect(url).toContain("tab=presets")
    expect(url).not.toContain("created=p1")
  })
})
