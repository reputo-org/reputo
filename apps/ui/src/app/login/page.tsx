"use client"

import { LogIn } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"

export default function LoginPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  // If the user already has a valid session, skip login.
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
      } catch {
        // Ignore — show login form
      }
      if (!cancelled) setChecking(false)
    }

    check()
    return () => {
      cancelled = true
    }
  }, [router])

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Reputo</CardTitle>
          <CardDescription>
            Sign in with your Deep ID account to continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button asChild className="w-full" size="lg">
            <a href="/api/v1/auth/deep-id/login">
              <LogIn className="mr-2 size-4" />
              Sign in with Deep ID
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
