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
        subtitle="Choose how you'd like to continue."
        footer={
          <>
            By continuing, you agree to our <a href="/terms">Terms</a> and{" "}
            <a href="/privacy">Privacy Policy</a>.
          </>
        }
      >
        <ProviderStack />
      </Hero>
    </PreAuthShell>
  )
}

function ProviderStack() {
  return (
    <div className="flex flex-col gap-2">
      {SIGN_IN_PROVIDERS.map((provider) => {
        if (provider.status === "live") {
          return (
            <a
              key={provider.id}
              className="rp-btn rp-btn-primary"
              href={provider.loginPath}
              aria-label={provider.ariaLabel}
            >
              <span className="rp-btn-pre">Sign in with</span>
              <ProviderLogo
                provider={provider.id}
                height={provider.logoHeight}
              />
            </a>
          )
        }
        return (
          <button
            key={provider.id}
            type="button"
            className="rp-btn rp-btn-disabled"
            disabled
            aria-disabled="true"
            aria-label={provider.ariaLabel}
          >
            <span className="rp-btn-pre">Sign in with</span>
            <span style={{ fontWeight: 600 }}>{provider.label}</span>
            <span
              className="rp-mono"
              style={{
                marginLeft: "auto",
                fontSize: 10,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "var(--rp-muted-soft)",
              }}
            >
              soon
            </span>
          </button>
        )
      })}
    </div>
  )
}
