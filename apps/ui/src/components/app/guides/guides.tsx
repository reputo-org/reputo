"use client"

import { ExternalLink } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GUIDES, guideEmbedUrl, guideViewerUrl } from "@/lib/guides"

export function Guides() {
  return (
    <Tabs defaultValue={GUIDES[0].id} className="w-full">
      <TabsList>
        {GUIDES.map((guide) => (
          <TabsTrigger key={guide.id} value={guide.id}>
            {guide.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {GUIDES.map((guide) => (
        <TabsContent key={guide.id} value={guide.id} className="mt-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            <div className="overflow-hidden rounded-lg border bg-muted/50">
              <iframe
                src={guideEmbedUrl(guide.slug)}
                title={guide.title}
                loading="lazy"
                allow="fullscreen"
                className="block w-full"
                style={{ aspectRatio: "1 / 1", minHeight: 480, border: 0 }}
              />
            </div>
            <a
              href={guideViewerUrl(guide.slug)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 self-end text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
              Open in a new tab
            </a>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  )
}
