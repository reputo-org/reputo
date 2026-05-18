import type { ReactNode } from "react"

interface HeroProps {
  /** Page title — plain bold text, no editorial flourishes. */
  title: string
  /** Short message rendered between the title and the CTA stack. */
  subtitle?: ReactNode
  /** CTA stack rendered beneath the title. */
  children: ReactNode
  /** Small muted footer (e.g. terms/privacy) rendered below the CTAs. */
  footer?: ReactNode
}

/**
 * Centered hero shared by every pre-auth route. An h1, optional subtitle,
 * the CTA stack, and an optional muted footer. Title styling lives in
 * `.rp-title` (globals.css).
 */
export function Hero({ title, subtitle, children, footer }: HeroProps) {
  return (
    <div className="flex flex-col gap-6 md:gap-7">
      <div className="flex flex-col gap-3 md:gap-4">
        <h1 className="rp-title">{title}</h1>
        {subtitle ? <p className="rp-subtitle">{subtitle}</p> : null}
      </div>
      {children}
      {footer ? <div className="rp-legal">{footer}</div> : null}
    </div>
  )
}
