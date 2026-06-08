// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AlgorithmPresets } from "@/components/app/presets/algorithm-presets"
import {
  useAlgorithmPresets,
  useCreateAlgorithmPreset,
  useCreateSnapshot,
  useDeleteAlgorithmPreset,
  useUpdateAlgorithmPreset,
} from "@/lib/api/hooks"

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/dashboard/algorithms/reputation",
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("@/lib/api/hooks", () => ({
  useAlgorithmPresets: vi.fn(),
  useCreateAlgorithmPreset: vi.fn(),
  useUpdateAlgorithmPreset: vi.fn(),
  useDeleteAlgorithmPreset: vi.fn(),
  useCreateSnapshot: vi.fn(),
}))

vi.mock("@/components/app/presets/create-preset-dialog", () => ({
  CreatePresetDialog: () => null,
}))
vi.mock("@/components/app/presets/edit-preset-dialog", () => ({
  EditPresetDialog: () => null,
}))
vi.mock("@/components/app/presets/preset-delete-dialog", () => ({
  PresetDeleteDialog: () => null,
}))
vi.mock("@/components/app/presets/preset-details-dialog", () => ({
  PresetDetailsDialog: () => null,
}))

const mockUsePresets = vi.mocked(useAlgorithmPresets)
const mockUseCreateSnapshot = vi.mocked(useCreateSnapshot)
const mockUseCreatePreset = vi.mocked(useCreateAlgorithmPreset)
const mockUseUpdatePreset = vi.mocked(useUpdateAlgorithmPreset)
const mockUseDeletePreset = vi.mocked(useDeleteAlgorithmPreset)

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

  mockUseCreatePreset.mockReturnValue(
    mutationStub() as unknown as ReturnType<typeof useCreateAlgorithmPreset>
  )
  mockUseUpdatePreset.mockReturnValue(
    mutationStub() as unknown as ReturnType<typeof useUpdateAlgorithmPreset>
  )
  mockUseDeletePreset.mockReturnValue(
    mutationStub() as unknown as ReturnType<typeof useDeleteAlgorithmPreset>
  )
})

describe("AlgorithmPresets", () => {
  it("renders a loading state while presets are fetching", () => {
    mockUsePresets.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof useAlgorithmPresets>)

    render(<AlgorithmPresets />)

    expect(screen.getByText("Loading Presets")).toBeInTheDocument()
  })

  it("renders an error state when the query fails", () => {
    mockUsePresets.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
    } as unknown as ReturnType<typeof useAlgorithmPresets>)

    render(<AlgorithmPresets />)

    expect(screen.getByText("Failed to Load Presets")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Try Again" })
    ).toBeInTheDocument()
  })

  it("renders an empty state when there are no presets", () => {
    mockUsePresets.mockReturnValue({
      data: { results: [] },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useAlgorithmPresets>)

    render(<AlgorithmPresets />)

    expect(screen.getByText("No Presets Found")).toBeInTheDocument()
  })

  it("renders a row per preset with its details", () => {
    render(<AlgorithmPresets />)

    expect(screen.getByText("My Preset")).toBeInTheDocument()
    expect(screen.getByText("Reputation Score")).toBeInTheDocument()
    expect(screen.getByText("1.0.0")).toBeInTheDocument()
    expect(screen.getByText("1 inputs")).toBeInTheDocument()
  })

  it("creates a snapshot and navigates when Run is clicked", async () => {
    const user = userEvent.setup()
    render(<AlgorithmPresets />)

    await user.click(screen.getByRole("button", { name: "Run" }))

    expect(createSnapshotMutateAsync).toHaveBeenCalledWith({
      algorithmPresetId: "p1",
      outputs: {},
    })
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1))
    const url = String(pushMock.mock.calls[0][0])
    expect(url).toContain("tab=snapshots")
    expect(url).toContain("preset=p1")
  })

  it("navigates to snapshots without running when View Snapshots is clicked", async () => {
    const user = userEvent.setup()
    render(<AlgorithmPresets />)

    await user.click(screen.getByRole("button", { name: "View Snapshots" }))

    expect(createSnapshotMutateAsync).not.toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledTimes(1)
    const url = String(pushMock.mock.calls[0][0])
    expect(url).toContain("tab=snapshots")
    expect(url).toContain("preset=p1")
  })
})
