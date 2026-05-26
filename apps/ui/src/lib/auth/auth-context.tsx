"use client"

import { useRouter } from "next/navigation"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import {
  markSessionAuthenticated,
  resetSessionAuthenticated,
} from "@/lib/api/services"

/** Access roles surfaced by the API on `/me`. */
export type AccessRole = "owner" | "admin"

export interface AuthSessionUser {
  id: string
  provider: string
  role: AccessRole
  sub: string
  aud?: string[]
  auth_time?: number
  email?: string
  email_verified?: boolean
  iat?: number
  iss?: string
  picture?: string
  rat?: number
  username?: string
  createdAt?: string
  updatedAt?: string
}

export interface AuthSession {
  authenticated: boolean
  provider?: string
  role?: AccessRole
  expiresAt?: string
  scope?: string[]
  user?: AuthSessionUser
}

interface AuthContextValue {
  /** The current session, or `null` while the bootstrap request is in flight. */
  session: AuthSession | null
  /** True until the initial `/me` call resolves or rejects. */
  loading: boolean
  /** Sign out: hits the logout endpoint, clears state, and navigates to /login. */
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthBootstrapProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        const res = await fetch("/api/v1/auth/me", {
          credentials: "include",
        })

        if (!res.ok) {
          if (!cancelled) {
            setSession(null)
            router.replace("/login")
          }
          return
        }

        const data: AuthSession = await res.json()

        if (!cancelled) {
          if (!data.authenticated) {
            setSession(null)
            router.replace("/login")
          } else {
            markSessionAuthenticated()
            setSession(data)
          }
        }
      } catch {
        if (!cancelled) {
          setSession(null)
          router.replace("/login")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
  }, [router])

  const logout = useCallback(async () => {
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "include",
      })
    } finally {
      resetSessionAuthenticated()
      setSession(null)
      router.replace("/login")
    }
  }, [router])

  const value = useMemo<AuthContextValue>(
    () => ({ session, loading, logout }),
    [session, loading, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuthSession(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error(
      "useAuthSession must be used within an AuthBootstrapProvider"
    )
  }
  return ctx
}
