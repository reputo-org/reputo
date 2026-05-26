import { resolve } from "node:path"
import { createVitestConfig } from "../../vitest.base"

export default createVitestConfig({
  name: "@reputo/ui",
  coverageInclude: ["src/**/*.ts", "src/**/*.tsx"],
  coverageExclude: [
    "src/app/**",
    "src/components/**",
    "src/core/fields/**",
    "src/core/form-context.tsx",
    "src/core/reputo-form.tsx",
    "src/hooks/**",
    "src/lib/api/hooks.ts",
    "src/lib/api/use-snapshot-events.ts",
    "src/lib/utils.ts",
    "src/middleware.ts",
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@reputo/algorithm-validator": resolve(
        __dirname,
        "../../packages/algorithm-validator/src/index.ts"
      ),
      "@reputo/reputation-algorithms": resolve(
        __dirname,
        "../../packages/reputation-algorithms/src/index.ts"
      ),
    },
  },
})
