import { ArrowRight } from "lucide-react"
import type { Metadata } from "next"
import { Hero } from "@/components/auth/hero"
import { PreAuthShell } from "@/components/auth/pre-auth-shell"

export const metadata: Metadata = {
  title: "Page not found · Reputo",
}

export default function NotFoundPage() {
  return (
    <PreAuthShell>
      <Hero title={["Page ", { italic: "not found" }, "."]}>
        <a className="rp-btn rp-btn-primary" href="/dashboard">
          <span>Back to dashboard</span>
          <ArrowRight width={16} height={16} aria-hidden="true" />
        </a>
      </Hero>
    </PreAuthShell>
  )
}
