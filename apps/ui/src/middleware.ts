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

  if (isPublic(pathname)) {
    return NextResponse.next()
  }

  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  if (!hasSession) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
