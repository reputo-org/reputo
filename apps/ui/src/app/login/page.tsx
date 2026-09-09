"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Hero } from "@/components/auth/hero"
import { PreAuthShell } from "@/components/auth/pre-auth-shell"
import { ProviderLogo } from "@/components/providers/provider-logo"
import { Spinner } from "@/components/ui/spinner"
import { SIGN_IN_PROVIDERS } from "@/lib/auth/sign-in-providers"

export default function LoginPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        const res = await fetch("/api/v1/auth/me", {
          credentials: "include",
        })
        if (res.ok) {
          const data = await res.json()
          if (data.authenticated && !cancelled) {
            router.replace("/dashboard")
            return
          }
        }
      } catch {}
      if (!cancelled) setChecking(false)
    }

    check()
    return () => {
      cancelled = true
    }
  }, [router])

  if (checking) {
    return (
      <PreAuthShell>
        <div className="flex justify-center py-2">
          <Spinner className="size-6" />
        </div>
      </PreAuthShell>
    )
  }

  return (
    <PreAuthShell>
      <Hero
        title="Sign in to Reputo"
        subtitle="Use your DeepID account to continue."
      >
        <div className="flex flex-col gap-4">
          <ProviderStack />
        </div>
      </Hero>
    </PreAuthShell>
  )
}

function ProviderStack() {
  return (
    <div className="flex flex-col gap-2">
      {SIGN_IN_PROVIDERS.map((provider) => (
        <a
          key={provider.id}
          className="rp-btn rp-btn-primary"
          href={provider.loginPath}
          aria-label={provider.ariaLabel}
        >
          <span className="rp-btn-pre">Sign in with</span>
          <ProviderLogo provider={provider.id} height={provider.logoHeight} />
        </a>
      ))}
    </div>
  )
}
