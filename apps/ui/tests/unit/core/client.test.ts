import type { AlgorithmDefinition } from "@reputo/reputation-algorithms"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockValidatePayload } = vi.hoisted(() => ({
  mockValidatePayload: vi.fn(),
}))

vi.mock("@reputo/algorithm-validator", () => ({
  validatePayload: mockValidatePayload,
}))

import { ReputoClientClass } from "../../../src/core/client"

const definition: AlgorithmDefinition = {
  key: "voting_engagement",
  name: "Voting Engagement",
  category: "Engagement",
  summary: "Scores voting diversity.",
  description: "Calculates voting engagement from a vote file.",
  version: "1.0.0",
  inputs: [],
  outputs: [],
  runtime: "typescript",
}

describe("ReputoClientClass", () => {
  beforeEach(() => {
    mockValidatePayload.mockReset()
  })

  it("registers schemas and delegates validation for known definitions", () => {
    const client = new ReputoClientClass()
    mockValidatePayload.mockReturnValue({ success: true, data: { ok: true } })

    client.registerSchema(definition)

    expect(client.hasSchema(definition.key)).toBe(true)
    expect(client.getSchema(definition.key)).toEqual(definition)
    expect(client.getAllSchemas()).toEqual([definition])
    expect(client.validate(definition.key, { threshold: 1 })).toEqual({
      success: true,
      data: { ok: true },
    })
    expect(mockValidatePayload).toHaveBeenCalledWith(definition, {
      threshold: 1,
    })
  })

  it("returns a schema error when validating an unknown definition", () => {
    const client = new ReputoClientClass()

    expect(client.validate("missing", {})).toEqual({
      success: false,
      errors: [
        {
          field: "_schema",
          message:
            'Could not find algorithm "missing". Refresh the page and try again.',
        },
      ],
    })
  })

  it("registers multiple schemas and validates requests", async () => {
    const client = new ReputoClientClass()
    const secondDefinition = { ...definition, key: "proposal_engagement" }
    mockValidatePayload.mockReturnValue({
      success: true,
      data: { ok: "request" },
    })

    client.registerSchemas([definition, secondDefinition])

    const result = await client.validateFromRequest(
      definition.key,
      new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify({ threshold: 2 }),
        headers: { "Content-Type": "application/json" },
      })
    )

    expect(client.getAllSchemas()).toEqual([definition, secondDefinition])
    expect(result).toEqual({ success: true, data: { ok: "request" } })
  })

  it("returns a request error when JSON parsing fails", async () => {
    const client = new ReputoClientClass()
    const request = {
      json: vi.fn().mockRejectedValue(new Error("bad json")),
    } as unknown as Request

    const result = await client.validateFromRequest(definition.key, request)

    expect(result).toEqual({
      success: false,
      errors: [
        {
          field: "_request",
          message: "Could not read the request: bad json",
        },
      ],
    })
  })
})
