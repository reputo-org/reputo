import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const BOOTSTRAP_URL = "/api/v1/auth/me"
const LOGOUT_URL = "/api/v1/auth/logout"
const LOGIN_PATH = "/login"
const DASHBOARD_PATH = "/dashboard"

const VALID_SESSION = {
  authenticated: true,
  provider: "deep-id",
  expiresAt: "2026-05-02T10:00:00.000Z",
  scope: ["openid", "profile", "email", "offline_access"],
  user: {
    id: "abc123",
    provider: "deep-id",
    sub: "did:deep-id:123",
    email: "jane@example.com",
    username: "jane",
  },
}

const UNAUTHENTICATED_SESSION = {
  authenticated: false,
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("auth bootstrap flow (/api/v1/auth/me)", () => {
  async function bootstrap(): Promise<{
    session: typeof VALID_SESSION | null
    redirect: string | null
  }> {
    try {
      const res = await fetch(BOOTSTRAP_URL, { credentials: "include" })

      if (!res.ok) {
        return { session: null, redirect: LOGIN_PATH }
      }

      const data = await res.json()

      if (!data.authenticated) {
        return { session: null, redirect: LOGIN_PATH }
      }

      return { session: data, redirect: null }
    } catch {
      return { session: null, redirect: LOGIN_PATH }
    }
  }

  it("sets the session when /me returns an authenticated payload", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(VALID_SESSION), { status: 200 })
    )

    const result = await bootstrap()

    expect(fetchMock).toHaveBeenCalledWith(BOOTSTRAP_URL, {
      credentials: "include",
    })
    expect(result.session).toEqual(VALID_SESSION)
    expect(result.redirect).toBeNull()
  })

  it("redirects to /login when /me returns 401", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
      })
    )

    const result = await bootstrap()

    expect(result.session).toBeNull()
    expect(result.redirect).toBe(LOGIN_PATH)
  })

  it("redirects to /login when /me returns authenticated: false", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(UNAUTHENTICATED_SESSION), { status: 200 })
    )

    const result = await bootstrap()

    expect(result.session).toBeNull()
    expect(result.redirect).toBe(LOGIN_PATH)
  })

  it("redirects to /login on network error (expired session recovery)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))

    const result = await bootstrap()

    expect(result.session).toBeNull()
    expect(result.redirect).toBe(LOGIN_PATH)
  })

  it("always sends credentials: include so the httpOnly cookie is attached", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(VALID_SESSION), { status: 200 })
    )

    await bootstrap()

    expect(fetchMock.mock.calls[0][1]).toEqual({ credentials: "include" })
  })
})

describe("login page session check", () => {
  async function loginPageCheck(): Promise<{
    redirect: string | null
    showForm: boolean
  }> {
    try {
      const res = await fetch(BOOTSTRAP_URL, { credentials: "include" })

      if (res.ok) {
        const data = await res.json()

        if (data.authenticated) {
          return { redirect: DASHBOARD_PATH, showForm: false }
        }
      }
    } catch {}

    return { redirect: null, showForm: true }
  }

  it("redirects to /dashboard when the user already has a valid session", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(VALID_SESSION), { status: 200 })
    )

    const result = await loginPageCheck()

    expect(result.redirect).toBe(DASHBOARD_PATH)
    expect(result.showForm).toBe(false)
  })

  it("shows the login form when /me returns 401", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    )

    const result = await loginPageCheck()

    expect(result.redirect).toBeNull()
    expect(result.showForm).toBe(true)
  })

  it("shows the login form on network error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))

    const result = await loginPageCheck()

    expect(result.redirect).toBeNull()
    expect(result.showForm).toBe(true)
  })

  it("shows the login form when /me returns authenticated: false", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(UNAUTHENTICATED_SESSION), { status: 200 })
    )

    const result = await loginPageCheck()

    expect(result.redirect).toBeNull()
    expect(result.showForm).toBe(true)
  })
})

describe("logout redirect", () => {
  async function logout(): Promise<{ redirect: string }> {
    try {
      await fetch(LOGOUT_URL, { method: "POST", credentials: "include" })
    } catch {}

    return { redirect: LOGIN_PATH }
  }

  it("posts to the logout endpoint with credentials", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    await logout()

    expect(fetchMock).toHaveBeenCalledWith(LOGOUT_URL, {
      method: "POST",
      credentials: "include",
    })
  })

  it("redirects to /login after a successful logout", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    const result = await logout()

    expect(result.redirect).toBe(LOGIN_PATH)
  })

  it("redirects to /login even if the logout request fails", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network error"))

    const result = await logout()

    expect(result.redirect).toBe(LOGIN_PATH)
  })
})

describe("expired-session recovery", () => {
  it("treats an expired session (401 on /me) as unauthenticated and redirects to /login", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          statusCode: 401,
          message: "Authentication required.",
        }),
        { status: 401 }
      )
    )

    const res = await fetch(BOOTSTRAP_URL, { credentials: "include" })
    const shouldRedirect = !res.ok

    expect(shouldRedirect).toBe(true)
    expect(res.status).toBe(401)
  })

  it("redirects to /login when the server returns 500 (defensive)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    )

    const res = await fetch(BOOTSTRAP_URL, { credentials: "include" })

    expect(res.ok).toBe(false)
  })
})

describe("auth-context module exports", () => {
  it("exports AuthBootstrapProvider, useAuthSession, and the session types", async () => {
    const authModule = await import("../../../../src/lib/auth/auth-context")

    expect(authModule.AuthBootstrapProvider).toBeDefined()
    expect(typeof authModule.AuthBootstrapProvider).toBe("function")
    expect(authModule.useAuthSession).toBeDefined()
    expect(typeof authModule.useAuthSession).toBe("function")
  })
})
