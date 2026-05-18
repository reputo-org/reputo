"use client"

import { RefreshCw } from "lucide-react"
import { useEffect } from "react"
import { Hero } from "@/components/auth/hero"
import { PreAuthShell } from "@/components/auth/pre-auth-shell"

interface ErrorPageProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Surface to the browser console; production error reporting (e.g.
    // Sentry) would hook in here.
    console.error(error)
  }, [error])

  return (
    <PreAuthShell>
      <Hero
        title="Something went wrong"
        subtitle="An unexpected error occurred. Try again, or contact support if it persists."
      >
        <button
          type="button"
          className="rp-btn rp-btn-primary"
          onClick={() => reset()}
        >
          <RefreshCw width={16} height={16} aria-hidden="true" />
          <span>Try again</span>
        </button>
      </Hero>
    </PreAuthShell>
  )
}
