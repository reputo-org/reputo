import type { ReactNode } from "react"
import { Wordmark } from "./wordmark"

interface PreAuthShellProps {
  children: ReactNode
}

/**
 * Centered card layout shared by every pre-authentication route. The REPUTO
 * wordmark sits above a bounded card that holds the hero + CTAs. Classic
 * Stripe / Auth0 / Firebase pattern, tuned for an OAuth-only flow with a
 * tight 440px column.
 */
export function PreAuthShell({ children }: PreAuthShellProps) {
  return (
    <main
      className="flex min-h-screen items-center justify-center px-6 py-12 md:px-16"
      style={{ background: "var(--rp-bg)" }}
    >
      <div className="flex w-full max-w-[440px] flex-col items-center gap-7 md:gap-9">
        <Wordmark />
        <div className="rp-card">{children}</div>
      </div>
    </main>
  )
}
