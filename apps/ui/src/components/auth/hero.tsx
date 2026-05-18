import type { ReactNode } from "react"

interface HeroProps {
  /**
   * Title parts. Strings render as-is; `{ italic: "word" }` wraps the word
   * in an italic `<em>` so a single accent word reads as `Sign in.`
   */
  title: ReadonlyArray<string | { italic: string }>
  /** CTA stack rendered beneath the title. */
  children: ReactNode
}

/**
 * Centered editorial hero shared by every pre-auth route: an h1 with an
 * italic accent word above the CTA stack. The italic accent is built into
 * the structure rather than inferred from copy so we never have to parse a
 * sentence to find the accent.
 */
export function Hero({ title, children }: HeroProps) {
  return (
    <div className="flex flex-col gap-7 md:gap-8">
      <h1 className="rp-title" style={{ fontSize: "clamp(36px, 5vw, 56px)" }}>
        {title.map((part, index) =>
          typeof part === "string" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: title parts are stable per render
            <span key={index}>{part}</span>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: title parts are stable per render
            <em key={index}>{part.italic}</em>
          )
        )}
      </h1>
      {children}
    </div>
  )
}
