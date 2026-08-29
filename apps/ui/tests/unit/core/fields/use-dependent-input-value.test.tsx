// @vitest-environment jsdom
import { renderHook } from "@testing-library/react"
import { useForm } from "react-hook-form"
import { describe, expect, it } from "vitest"
import { useDependentInputValue } from "@/core/fields/use-dependent-input-value"

function useHarness(defaultValues: Record<string, unknown>, fieldKey: string) {
  const form = useForm({ defaultValues })
  return useDependentInputValue(
    fieldKey,
    "community_connection_id",
    form.control
  )
}

describe("useDependentInputValue", () => {
  it("reads the dependency directly at the form root", () => {
    const { result } = renderHook(() =>
      useHarness(
        { community_connection_id: "conn-1", resources: [] },
        "resources"
      )
    )

    expect(result.current).toBe("conn-1")
  })

  it("resolves the dependency by key inside a positional child inputs row", () => {
    const { result } = renderHook(() =>
      useHarness(
        {
          sub_algorithms: [
            {
              algorithm_key: "discord_engagement",
              inputs: [
                { key: "community_connection_id", value: "conn-2" },
                { key: "resources", value: [] },
              ],
            },
          ],
        },
        "sub_algorithms.0.inputs.1.value"
      )
    )

    expect(result.current).toBe("conn-2")
  })

  it("returns undefined without a dependsOn key", () => {
    const { result } = renderHook(() => {
      const form = useForm<Record<string, unknown>>({
        defaultValues: { resources: [] },
      })
      return useDependentInputValue("resources", undefined, form.control)
    })

    expect(result.current).toBeUndefined()
  })
})
