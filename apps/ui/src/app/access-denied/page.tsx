import { ArrowRight } from "lucide-react"
import type { Metadata } from "next"
import { Hero } from "@/components/auth/hero"
import { PreAuthShell } from "@/components/auth/pre-auth-shell"
import { resolveAccessDeniedCopy } from "@/lib/access-denied/copy"

export const metadata: Metadata = {
  title: "Access denied · Reputo",
}

export const dynamic = "force-dynamic"

interface AccessDeniedPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function AccessDeniedPage({
  searchParams,
}: AccessDeniedPageProps) {
  const params = await searchParams
  const copy = resolveAccessDeniedCopy(firstValue(params.reason))

  return (
    <PreAuthShell>
      <Hero title={copy.titleParts}>
        <a className="rp-btn rp-btn-primary" href={copy.cta.href}>
          <span>{copy.cta.label}</span>
          <ArrowRight width={16} height={16} aria-hidden="true" />
        </a>
      </Hero>
    </PreAuthShell>
  )
}
