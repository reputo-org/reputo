import "@testing-library/jest-dom/vitest"

const noop = () => undefined

if (typeof window !== "undefined") {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: noop,
      removeListener: noop,
      addEventListener: noop,
      removeEventListener: noop,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList

  window.ResizeObserver = class {
    observe = noop
    unobserve = noop
    disconnect = noop
  } as unknown as typeof ResizeObserver

  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = noop
  Element.prototype.releasePointerCapture = noop
  Element.prototype.scrollIntoView = noop
}
