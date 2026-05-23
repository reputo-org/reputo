import path from "node:path"
import type { NextConfig } from "next"

import { env } from "./src/lib/env"

const apiProxyTarget = env.API_PROXY_TARGET?.replace(/\/+$/, "")

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),

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
