import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import { env } from "./lib/env"

const AUTH_COOKIE_NAME = env.AUTH_COOKIE_NAME

/** Routes that don't require an auth cookie. */
const PUBLIC_PATHS = ["/login", "/access-denied"]

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  )
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const hasSession = request.cookies.has(AUTH_COOKIE_NAME)

  // Public routes stay public. The login page verifies the session with `/me`
  // before redirecting, which avoids a cookie-only redirect loop.
  if (isPublic(pathname)) {
    return NextResponse.next()
  }

  // Root → redirect to dashboard (auth check happens there).
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  // Protected routes — require session cookie.
  if (!hasSession) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
}
