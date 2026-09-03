// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { queryKeys } from "@/lib/api/hooks"
import { useCommunityLiveUpdates } from "@/lib/api/use-community-events"

const { subscribeToEvents, handleAuthFailure } = vi.hoisted(() => ({
  subscribeToEvents: vi.fn(),
  handleAuthFailure: vi.fn(),
}))

vi.mock("@/lib/api/services", () => ({
  communityApi: { subscribeToEvents },
  handleAuthFailure,
}))

class FakeEventSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  readyState = FakeEventSource.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn(() => {
    this.readyState = FakeEventSource.CLOSED
  })

  open() {
    this.readyState = FakeEventSource.OPEN
    this.onopen?.()
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
}

let sources: FakeEventSource[]
let client: QueryClient

function Probe({ enabled = true }: { enabled?: boolean }) {
  const live = useCommunityLiveUpdates({ enabled })
  return (
    <output>
      {live.connected ? "connected" : "offline"}:{live.watchIntervalMs ?? "-"}
    </output>
  )
}

function renderProbe(children: ReactNode) {
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  sources = []
  client = new QueryClient()
  vi.spyOn(client, "invalidateQueries").mockResolvedValue()
  vi.spyOn(client, "removeQueries")
  ;(globalThis as { EventSource?: unknown }).EventSource = FakeEventSource
  subscribeToEvents.mockImplementation(() => {
    const source = new FakeEventSource()
    sources.push(source)
    return source
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("useCommunityLiveUpdates", () => {
  it("opens one shared stream for many subscribers and closes it with the last", () => {
    const view = renderProbe(
      <>
        <Probe />
        <Probe />
      </>
    )

    expect(subscribeToEvents).toHaveBeenCalledTimes(1)

    view.unmount()
    expect(sources[0]?.close).toHaveBeenCalledTimes(1)
  })

  it("does nothing while disabled", () => {
    renderProbe(<Probe enabled={false} />)

    expect(subscribeToEvents).not.toHaveBeenCalled()
    expect(screen.getByRole("status")).toHaveTextContent("offline:-")
  })

  it("reports the watch cadence and refetches what an event touches", () => {
    renderProbe(<Probe />)
    const source = sources[0] as FakeEventSource

    act(() => source.open())
    expect(screen.getByRole("status")).toHaveTextContent("connected:-")
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.communityConnections.lists(),
    })

    act(() =>
      source.emit({
        type: "community_connection:watch",
        data: { intervalMs: 30_000 },
      })
    )
    expect(screen.getByRole("status")).toHaveTextContent("connected:30000")

    act(() => {
      source.emit({
        type: "community_connection:updated",
        data: { id: "conn-1", status: "broken" },
      })
      source.emit({
        type: "community_connection:updated",
        data: { id: "conn-1", status: "active" },
      })
      vi.advanceTimersByTime(300)
    })
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.communityConnections.resources("conn-1"),
    })
    // Two changes to one connection refetch its resources once.
    expect(
      vi
        .mocked(client.invalidateQueries)
        .mock.calls.filter(
          ([options]) =>
            JSON.stringify(options?.queryKey) ===
            JSON.stringify(queryKeys.communityConnections.resources("conn-1"))
        )
    ).toHaveLength(1)

    act(() =>
      source.emit({
        type: "community_connection:removed",
        data: { id: "conn-1" },
      })
    )
    expect(client.removeQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.communityConnections.resources("conn-1"),
    })
  })

  it("reconnects after a transport error and stops once nobody listens", () => {
    const view = renderProbe(<Probe />)
    const first = sources[0] as FakeEventSource
    act(() => first.open())

    act(() => {
      first.readyState = FakeEventSource.CONNECTING
      first.onerror?.()
    })
    expect(screen.getByRole("status")).toHaveTextContent("offline")

    act(() => vi.advanceTimersByTime(5_000))
    expect(subscribeToEvents).toHaveBeenCalledTimes(2)

    view.unmount()
    act(() => vi.advanceTimersByTime(10_000))
    expect(subscribeToEvents).toHaveBeenCalledTimes(2)
  })

  it("treats three missed heartbeats as a dead stream and reconnects", () => {
    renderProbe(<Probe />)
    const first = sources[0] as FakeEventSource
    act(() => first.open())

    act(() => vi.advanceTimersByTime(30_000))
    expect(subscribeToEvents).toHaveBeenCalledTimes(1)

    act(() => vi.advanceTimersByTime(20_000))
    expect(first.close).toHaveBeenCalled()
    expect(subscribeToEvents).toHaveBeenCalledTimes(2)
  })

  it("keeps a stream that heartbeats", () => {
    renderProbe(<Probe />)
    const source = sources[0] as FakeEventSource
    act(() => source.open())

    for (let i = 0; i < 4; i++) {
      act(() => {
        vi.advanceTimersByTime(15_000)
        source.emit({
          type: "community_connection:heartbeat",
          data: { at: new Date().toISOString() },
        })
      })
    }

    expect(subscribeToEvents).toHaveBeenCalledTimes(1)
    expect(source.close).not.toHaveBeenCalled()
    expect(screen.getByRole("status")).toHaveTextContent("connected")
  })

  it("checks the session when the server closes the stream, and signs out on a dead one", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false })
    vi.stubGlobal("fetch", fetchMock)
    renderProbe(<Probe />)
    const source = sources[0] as FakeEventSource

    act(() => {
      source.readyState = FakeEventSource.CLOSED
      source.onerror?.()
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/me", {
      credentials: "include",
    })
    expect(handleAuthFailure).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})
