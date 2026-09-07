import type { ReactNode } from "react"

interface HeroProps {
  /** Page title — plain bold text, no editorial flourishes. */
  title: string
  /** Short message rendered between the title and the CTA stack. */
  subtitle?: ReactNode
  /** CTA stack rendered beneath the title. */
  children: ReactNode
}

/**
 * Centered hero shared by every pre-auth route. An h1, optional subtitle,
 * and the CTA stack. Title styling lives in `.rp-title` (globals.css).
 */
export function Hero({ title, subtitle, children }: HeroProps) {
  return (
    <div className="flex flex-col gap-6 md:gap-7">
      <div className="flex flex-col gap-3 md:gap-4">
        <h1 className="rp-title">{title}</h1>
        {subtitle ? <p className="rp-subtitle">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  )
}
