import axios from "axios"

/**
 * Extracts the HTTP status from a thrown axios error. Returns `undefined`
 * for network errors, non-axios errors, or anything else without a
 * `response.status`. Useful for branching toast copy on distinct API
 * outcomes (201 vs 409 vs 403 etc.).
 */
export function extractApiStatus(error: unknown): number | undefined {
  if (axios.isAxiosError(error)) {
    return error.response?.status
  }
  return undefined
}
