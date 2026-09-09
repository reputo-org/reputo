"use client"

import { ExternalLink } from "lucide-react"
import { useState } from "react"
import {
  GUIDES,
  type Guide,
  getGuidesByGroup,
  guideEmbedUrl,
  guideViewerUrl,
} from "@/lib/guides"
import { cn } from "@/lib/utils"

export function Guides() {
  const groups = getGuidesByGroup()
  const [selected, setSelected] = useState<Guide>(GUIDES[0])

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label="Guides" className="flex flex-col gap-5">
        {groups.map(({ group, guides }) => (
          <section key={group.id} className="flex flex-col gap-1.5">
            <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {group.title}
            </h2>
            <ul className="flex flex-col gap-0.5">
              {guides.map((guide) => {
                const isSelected = guide.id === selected.id
                return (
                  <li key={guide.id}>
                    <button
                      type="button"
                      aria-current={isSelected ? "page" : undefined}
                      onClick={() => setSelected(guide)}
                      className={cn(
                        "hover:bg-muted w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                        isSelected
                          ? "bg-muted font-medium"
                          : "text-muted-foreground"
                      )}
                    >
                      {guide.title}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </nav>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{selected.title}</h2>
          <a
            href={guideViewerUrl(selected.slug)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            <ExternalLink className="size-3.5" />
            Open in a new tab
          </a>
        </div>
        <div className="bg-muted/50 overflow-hidden rounded-lg border">
          <iframe
            key={selected.id}
            src={guideEmbedUrl(selected.slug)}
            title={selected.title}
            loading="lazy"
            allow="fullscreen"
            className="block w-full"
            style={{ aspectRatio: "1 / 1", minHeight: 480, border: 0 }}
          />
        </div>
      </div>
    </div>
  )
}
