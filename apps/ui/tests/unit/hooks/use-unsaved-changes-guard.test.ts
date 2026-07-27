// @vitest-environment jsdom
import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard"

describe("useUnsavedChangesGuard", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("registers beforeunload only while enabled", () => {
    const addSpy = vi.spyOn(window, "addEventListener")
    const removeSpy = vi.spyOn(window, "removeEventListener")

    const { rerender, unmount } = renderHook(
      ({ enabled }) => useUnsavedChangesGuard(enabled),
      { initialProps: { enabled: false } }
    )

    expect(addSpy).not.toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function)
    )

    rerender({ enabled: true })
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function))

    unmount()
    expect(removeSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function))
  })

  it("blocks the unload event while enabled", () => {
    const addSpy = vi.spyOn(window, "addEventListener")
    renderHook(() => useUnsavedChangesGuard(true))

    const handler = addSpy.mock.calls.find(
      ([type]) => type === "beforeunload"
    )?.[1] as (event: BeforeUnloadEvent) => void

    const event = new Event("beforeunload") as BeforeUnloadEvent
    const preventDefault = vi.spyOn(event, "preventDefault")
    handler(event)

    expect(preventDefault).toHaveBeenCalled()
  })

  it("stops guarding once disabled", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener")

    const { rerender } = renderHook(
      ({ enabled }) => useUnsavedChangesGuard(enabled),
      { initialProps: { enabled: true } }
    )

    rerender({ enabled: false })
    expect(removeSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function))
  })
})
