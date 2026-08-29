"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { toast } from "sonner"
import { describeConnectOutcome } from "@/lib/community/platforms"

/**
 * Reports the outcome the API redirected back with, then strips it from the URL
 * so a refresh does not repeat the toast. Rendered inside a Suspense boundary
 * because it reads search params.
 */
export function ConnectOutcomeToast() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const connected = searchParams.get("connected")
  const error = searchParams.get("error")

  useEffect(() => {
    const outcome = describeConnectOutcome({ connected, error })
    if (!outcome) return

    if (outcome.kind === "success") {
      toast.success(outcome.message)
    } else {
      toast.error(outcome.message)
    }

    router.replace(pathname, { scroll: false })
  }, [connected, error, pathname, router])

  return null
}
