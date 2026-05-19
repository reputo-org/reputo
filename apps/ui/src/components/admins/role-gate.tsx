"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Spinner } from "@/components/ui/spinner"
import { useAuthSession } from "@/lib/auth/auth-context"
import { decideRoleGate, type RoleGateInputs } from "@/lib/auth/role-gate"

interface RoleGateProps {
  requiredRole: RoleGateInputs["requiredRole"]
  loginHref?: string
  forbiddenHref?: string
  children: React.ReactNode
}

/**
 * Client-side role guard. While the session bootstrap is in flight we render
 * a spinner. Unauthenticated visitors are sent to `loginHref` (default
 * `/login`); authenticated users with the wrong role are sent to
 * `forbiddenHref` (default `/dashboard`).
 *
 * The decision lives in {@link decideRoleGate} so it can be unit-tested
 * without React.
 */
export function RoleGate({
  requiredRole,
  loginHref,
  forbiddenHref,
  children,
}: RoleGateProps) {
  const router = useRouter()
  const { session, loading } = useAuthSession()

  const decision = decideRoleGate({
    loading,
    authenticated: Boolean(session?.authenticated),
    role: session?.user?.role,
    requiredRole,
    loginHref,
    forbiddenHref,
  })

  const redirectHref = decision.kind === "redirect" ? decision.href : null

  useEffect(() => {
    if (redirectHref) {
      router.replace(redirectHref)
    }
  }, [redirectHref, router])

  if (decision.kind === "allow") {
    return <>{children}</>
  }

  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner className="size-6" />
    </div>
  )
}
