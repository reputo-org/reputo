import {
  type ValidationResult,
  validatePayload,
} from "@reputo/algorithm-validator"
import type { AlgorithmDefinition } from "@reputo/reputation-algorithms"

class SchemaRegistry {
  private schemas: Map<string, AlgorithmDefinition> = new Map()

  register(schema: AlgorithmDefinition) {
    this.schemas.set(schema.key, schema)
  }

  get(key: string): AlgorithmDefinition | undefined {
    return this.schemas.get(key)
  }

  has(key: string): boolean {
    return this.schemas.has(key)
  }

  getAll(): AlgorithmDefinition[] {
    return Array.from(this.schemas.values())
  }
}

class ReputoClientClass {
  private registry = new SchemaRegistry()

  registerSchema(definition: AlgorithmDefinition) {
    this.registry.register(definition)
    return this
  }

  registerSchemas(definitions: AlgorithmDefinition[]) {
    for (const def of definitions) {
      this.registry.register(def)
    }
    return this
  }

  /**
   * Validate a payload against a registered algorithm definition
   *
   * @param schemaKey - The key of the registered algorithm definition
   * @param payload - The data to validate
   * @returns ValidationResult with success status and errors if any
   *
   * @example
   * ```typescript
   * const result = reputoClient.validate("voting_engagement", formData);
   * if (result.success) {
   *   console.log("Valid data:", result.data);
   * } else {
   *   console.error("Validation errors:", result.errors);
   * }
   * ```
   */
  validate(schemaKey: string, payload: any): ValidationResult {
    const definition = this.registry.get(schemaKey)

    if (!definition) {
      return {
        success: false,
        errors: [
          {
            field: "_schema",
            message: `Algorithm definition "${schemaKey}" not found. Please register it first.`,
          },
        ],
      }
    }

    return validatePayload(definition, payload)
  }

  validateWithSchema(
    definition: AlgorithmDefinition,
    payload: any
  ): ValidationResult {
    return validatePayload(definition, payload)
  }

  getSchema(key: string): AlgorithmDefinition | undefined {
    return this.registry.get(key)
  }

  hasSchema(key: string): boolean {
    return this.registry.has(key)
  }

  getAllSchemas(): AlgorithmDefinition[] {
    return this.registry.getAll()
  }

  async validateFromRequest(
    schemaKey: string,
    request: Request
  ): Promise<ValidationResult> {
    try {
      const payload = await request.json()
      return this.validate(schemaKey, payload)
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            field: "_request",
            message: `Failed to parse request: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          },
        ],
      }
    }
  }
}

export const reputoClient = new ReputoClientClass()

export { ReputoClientClass }
