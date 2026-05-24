import { z } from "zod"

export const envSchema = z.object({
  AUTH_COOKIE_NAME: z
    .string()
    .min(1)
    .default("reputo_auth_session")
    .describe(
      "Opaque auth session cookie name; must match the API's AUTH_COOKIE_NAME"
    ),
  API_PROXY_TARGET: z
    .string()
    .url()
    .optional()
    .describe(
      "Local-dev only: target the Next.js rewrite proxies /api/* to. Leave unset in Docker; Traefik routes /api."
    ),
  PORT: z.coerce
    .number()
    .int()
    .positive()
    .default(3000)
    .describe("Port `next start` listens on (Dockerfile defaults to 8080)"),
})

export type Env = z.infer<typeof envSchema>

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  const lines = parsed.error.issues.map((issue) => {
    const key = issue.path.length > 0 ? issue.path.join(".") : "<root>"
    return `  - ${key}: ${issue.message}`
  })
  const message = `Invalid environment variables:\n${lines.join("\n")}`
  // `process.stderr` isn't available in the Edge runtime (middleware.ts),
  // so use `console.error` which works in both Node and Edge contexts.
  console.error(message)
  throw new Error(message)
}

export const env: Env = parsed.data
