"use client"

import { Suspense } from "react"
import { CommunityConnections } from "@/components/community/community-connections"
import { ConnectOutcomeToast } from "@/components/community/connect-outcome-toast"

export default function CommunityPage() {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={null}>
        <ConnectOutcomeToast />
      </Suspense>

      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl tracking-tight">Communities</h1>
        <p className="text-muted-foreground text-sm">
          Connect the platforms Reputo scores. Reputo reads ids, timestamps, and
          counts only — never message content.
        </p>
      </header>

      <CommunityConnections />
    </div>
  )
}
