import SEAL from 'node-seal';

/** The initialized node-seal WASM module (the transparent-ciphertext-rejecting build). */
export type SealRuntime = Awaited<ReturnType<typeof SEAL>>;

let runtime: Promise<SealRuntime> | undefined;

/**
 * Process-wide node-seal runtime. The WASM module itself holds no key or
 * context state — those are per-evaluator objects with explicit lifetimes —
 * and re-instantiating it would leak a whole WASM heap per activity, so one
 * instance is shared and initialized lazily.
 */
export function getSealRuntime(): Promise<SealRuntime> {
  runtime ??= SEAL();
  return runtime;
}

/** Minimal surface of an embind-managed WASM object. */
export interface SealHandle {
  delete(): void;
  isDeleted(): boolean;
}

/** Created/released counters shared by every scope of one evaluator instance. */
export interface SealHandleLedger {
  created: number;
  released: number;
}

export function createSealHandleLedger(): SealHandleLedger {
  return { created: 0, released: 0 };
}

/**
 * Tracks WASM handles so success and error paths release them exactly once.
 * Every SEAL object an evaluator creates is registered here; `dispose()` frees
 * in reverse creation order and is idempotent.
 */
export class SealHandleScope {
  private handles: SealHandle[] = [];

  constructor(private readonly ledger: SealHandleLedger) {}

  track<T extends SealHandle>(handle: T): T {
    this.handles.push(handle);
    this.ledger.created += 1;
    return handle;
  }

  /** Releases one tracked handle early (before scope disposal). */
  release(handle: SealHandle): void {
    const index = this.handles.indexOf(handle);
    if (index === -1) {
      return;
    }
    this.handles.splice(index, 1);
    if (!handle.isDeleted()) {
      handle.delete();
    }
    this.ledger.released += 1;
  }

  dispose(): void {
    for (let index = this.handles.length - 1; index >= 0; index--) {
      const handle = this.handles[index];
      if (!handle.isDeleted()) {
        handle.delete();
      }
      this.ledger.released += 1;
    }
    this.handles = [];
  }
}

/**
 * Human-readable message for a SEAL failure. The throws-build surfaces C++
 * exceptions as `WebAssembly.Exception` values (not `Error`s) whose `message`
 * is a `[type, what]` pair; anything else falls back to `String(error)`.
 */
export function describeSealError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error as { message: unknown };
    if (Array.isArray(message)) {
      const parts = message.filter((part): part is string => typeof part === 'string');
      if (parts.length > 0) {
        return parts.join(': ');
      }
    }
    if (typeof message === 'string') {
      return message;
    }
  }
  return String(error);
}
