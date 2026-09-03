"use client"

import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { useEffect, useSyncExternalStore } from "react"
import { queryKeys } from "./hooks"
import { communityApi, handleAuthFailure } from "./services"
import type {
  CommunityConnectionEventDto,
  CommunityRealtimeStatusDto,
} from "./types"

export interface CommunityLiveState {
  /** The events stream is open right now. */
  connected: boolean
  /**
   * Which platforms are pushing their changes right now. Undefined until the
   * stream's first event says.
   */
  realtime: CommunityRealtimeStatusDto | undefined
}

const RECONNECT_DELAY_MS = 5_000
/** Several changes to one connection in quick succession refetch its resources once. */
const RESOURCE_REFETCH_DEBOUNCE_MS = 250
/**
 * The API sends a heartbeat every 15 s. A proxy can drop the API's half of the
 * stream and leave the browser's half open, which the browser never reports;
 * three missed heartbeats is when the stream is treated as dead instead.
 */
const SILENCE_TIMEOUT_MS = 45_000
const WATCHDOG_INTERVAL_MS = 10_000

/**
 * One events stream per page, shared by every component that wants live
 * connection updates: the first subscriber opens it, the last closes it.
 */
let subscribers = 0
let source: EventSource | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let watchdog: ReturnType<typeof setInterval> | null = null
let lastMessageAt = 0
let state: CommunityLiveState = { connected: false, realtime: undefined }
const listeners = new Set<() => void>()
const pendingResourceRefetches = new Map<
  string,
  ReturnType<typeof setTimeout>
>()

function setState(next: Partial<CommunityLiveState>): void {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

function subscribeToState(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getState = (): CommunityLiveState => state

function invalidateConnections(client: QueryClient): void {
  void client.invalidateQueries({
    queryKey: queryKeys.communityConnections.lists(),
  })
}

function invalidateResources(client: QueryClient, id: string): void {
  const pending = pendingResourceRefetches.get(id)
  if (pending) clearTimeout(pending)
  pendingResourceRefetches.set(
    id,
    setTimeout(() => {
      pendingResourceRefetches.delete(id)
      void client.invalidateQueries({
        queryKey: queryKeys.communityConnections.resources(id),
      })
    }, RESOURCE_REFETCH_DEBOUNCE_MS)
  )
}

function handleEvent(
  client: QueryClient,
  event: CommunityConnectionEventDto
): void {
  switch (event.type) {
    case "community_connection:heartbeat":
      return
    case "community_connection:watch":
      setState({ realtime: event.data })
      return
    case "community_connection:updated":
      invalidateConnections(client)
      invalidateResources(client, event.data.id)
      return
    case "community_connection:removed":
      invalidateConnections(client)
      client.removeQueries({
        queryKey: queryKeys.communityConnections.resources(event.data.id),
      })
      return
  }
}

function scheduleReconnect(client: QueryClient): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (subscribers > 0) connect(client)
  }, RECONNECT_DELAY_MS)
}

function startWatchdog(client: QueryClient): void {
  if (watchdog) return
  watchdog = setInterval(() => {
    if (!source || source.readyState !== EventSource.OPEN) return
    if (Date.now() - lastMessageAt < SILENCE_TIMEOUT_MS) return
    source.close()
    source = null
    setState({ connected: false })
    connect(client)
  }, WATCHDOG_INTERVAL_MS)
}

function stopWatchdog(): void {
  if (watchdog) {
    clearInterval(watchdog)
    watchdog = null
  }
}

function connect(client: QueryClient): void {
  source?.close()
  const stream = communityApi.subscribeToEvents()
  source = stream
  lastMessageAt = Date.now()
  startWatchdog(client)

  stream.onopen = () => {
    lastMessageAt = Date.now()
    setState({ connected: true })
    // Anything that changed while the stream was down is caught up here.
    invalidateConnections(client)
  }

  stream.onmessage = (message) => {
    lastMessageAt = Date.now()
    try {
      handleEvent(
        client,
        JSON.parse(message.data) as CommunityConnectionEventDto
      )
    } catch (error) {
      console.error("Failed to parse community connection event:", error)
    }
  }

  stream.onerror = () => {
    const serverRejected = stream.readyState === EventSource.CLOSED
    stream.close()
    if (source === stream) source = null
    setState({ connected: false })
    if (subscribers === 0) return

    if (serverRejected) {
      // A closed stream is how an expired session shows up; confirm before
      // reconnecting forever against a 401.
      fetch("/api/v1/auth/me", { credentials: "include" })
        .then((response) => {
          if (response.ok) {
            scheduleReconnect(client)
          } else {
            handleAuthFailure()
          }
        })
        .catch(() => handleAuthFailure())
      return
    }
    scheduleReconnect(client)
  }
}

function release(): void {
  subscribers = Math.max(0, subscribers - 1)
  if (subscribers > 0) return
  stopWatchdog()
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  for (const timer of pendingResourceRefetches.values()) clearTimeout(timer)
  pendingResourceRefetches.clear()
  source?.close()
  source = null
  setState({ connected: false, realtime: undefined })
}

/**
 * Keeps the community connection queries live: whenever a platform reports a
 * change — its live feed, a Re-check, a snapshot failure — this refetches the
 * connections and the affected connection's resources without a reload, in
 * every open tab. Mount it wherever connections or their resources are shown;
 * the stream is shared.
 */
export function useCommunityLiveUpdates(options?: {
  enabled?: boolean
}): CommunityLiveState {
  const enabled = options?.enabled ?? true
  const client = useQueryClient()

  useEffect(() => {
    if (!enabled) return
    subscribers += 1
    if (subscribers === 1) connect(client)
    return release
  }, [enabled, client])

  return useSyncExternalStore(subscribeToState, getState, getState)
}
