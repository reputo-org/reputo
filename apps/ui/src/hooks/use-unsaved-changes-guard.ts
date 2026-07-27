"use client"

import { useEffect } from "react"

/**
 * Warns before the browser unloads the page while `enabled`. In-app
 * navigation is guarded by the caller's own confirm dialog — the App Router
 * has no reliable route-change interception.
 */
export function useUnsavedChangesGuard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
    }
  }, [enabled])
}
