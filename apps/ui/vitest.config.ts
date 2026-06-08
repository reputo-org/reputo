import { resolve } from "node:path"
import { defineConfig, mergeConfig } from "vitest/config"
import { createVitestConfig } from "../../vitest.base"

const config = createVitestConfig({
  name: "@reputo/ui",
  setupFiles: ["./tests/setup.ts"],
  coverageInclude: ["src/**/*.ts", "src/**/*.tsx"],
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

export default mergeConfig(
  config,
  defineConfig({
    esbuild: {
      jsx: "automatic",
    },
  })
)
