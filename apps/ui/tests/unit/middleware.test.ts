import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ORIGINAL_COOKIE_NAME = process.env.AUTH_COOKIE_NAME

function createRequest(pathname: string, cookie?: string): NextRequest {
  return new NextRequest(`https://reputo.local${pathname}`, {
    headers: cookie ? { cookie } : undefined,
  })
}

async function loadMiddleware(cookieName: string) {
  vi.resetModules()
  process.env.AUTH_COOKIE_NAME = cookieName
  return import("../../src/middleware")
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.resetModules()

  if (ORIGINAL_COOKIE_NAME == null) {
    delete process.env.AUTH_COOKIE_NAME
  } else {
    process.env.AUTH_COOKIE_NAME = ORIGINAL_COOKIE_NAME
  }
})

describe("ui middleware", () => {
  it("keeps the login route public even when the auth cookie is present", async () => {
    const { middleware } = await loadMiddleware("reputo_auth_session")

    const response = middleware(
      createRequest("/login", "reputo_auth_session=session-123")
    )

    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(response.headers.get("location")).toBeNull()
  })

  it("redirects protected routes to login when the auth cookie is missing", async () => {
    const { middleware } = await loadMiddleware("reputo_auth_session")

    const response = middleware(createRequest("/dashboard"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://reputo.local/login")
  })

  it("redirects / to /dashboard", async () => {
    const { middleware } = await loadMiddleware("reputo_auth_session")

    const response = middleware(
      createRequest("/", "reputo_auth_session=session-123")
    )

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://reputo.local/dashboard"
    )
  })

  it("redirects / to /dashboard even without a session cookie", async () => {
    const { middleware } = await loadMiddleware("reputo_auth_session")

    const response = middleware(createRequest("/"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://reputo.local/dashboard"
    )
  })

  it("protects nested /dashboard/** routes", async () => {
    const { middleware } = await loadMiddleware("reputo_auth_session")

    const response = middleware(createRequest("/dashboard/settings/profile"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://reputo.local/login")
  })

  it("allows nested /dashboard/** routes when the auth cookie is present", async () => {
    const { middleware } = await loadMiddleware("reputo_auth_session")

    const response = middleware(
      createRequest(
        "/dashboard/presets/edit",
        "reputo_auth_session=session-123"
      )
    )

    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(response.headers.get("location")).toBeNull()
  })

  it("keeps /login subpaths public", async () => {
    const { middleware } = await loadMiddleware("reputo_auth_session")

    const response = middleware(createRequest("/login/callback"))

    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(response.headers.get("location")).toBeNull()
  })

  it("redirects unknown protected routes to login", async () => {
    const { middleware } = await loadMiddleware("reputo_auth_session")

    const response = middleware(createRequest("/settings"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://reputo.local/login")
  })

  it("exports a matcher config that excludes api and _next paths", async () => {
    const { config } = await loadMiddleware("reputo_auth_session")

    expect(config.matcher).toBeDefined()
    expect(config.matcher[0]).toContain("(?!api")
    expect(config.matcher[0]).toContain("_next/static")
    expect(config.matcher[0]).toContain("favicon.ico")
  })

  it("throws when AUTH_COOKIE_NAME is missing", async () => {
    vi.resetModules()
    delete process.env.AUTH_COOKIE_NAME
    await expect(import("../../src/middleware")).rejects.toThrow(
      /AUTH_COOKIE_NAME/
    )
  })
})
