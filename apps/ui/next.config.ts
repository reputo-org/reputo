import path from "node:path"
import type { NextConfig } from "next"

import { env } from "./src/lib/env"

const apiProxyTarget = env.API_PROXY_TARGET?.replace(/\/+$/, "")

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),

  // esbuild is build-tooling (tsx/vite/vitest); tracing pulls its platform
  // binary into the standalone bundle, which ships a scanner-flagged Go
  // binary into the runtime image for no reason.
  outputFileTracingExcludes: {
    "*": ["**/@esbuild/**", "**/esbuild/**"],
  },

  transpilePackages: [
    "@reputo/algorithm-validator",
    "@reputo/reputation-algorithms",
  ],

  async rewrites() {
    if (!apiProxyTarget) return []
    return [
      { source: "/api/:path*", destination: `${apiProxyTarget}/api/:path*` },
    ]
  },
}

export default nextConfig
