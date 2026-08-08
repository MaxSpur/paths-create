import { beforeEach } from "vitest";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value))
  };
}

// Node 26 exposes an unavailable global localStorage unless it is launched with
// --localstorage-file. Tests need deterministic, process-local storage instead.
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: createMemoryStorage()
});

beforeEach(() => {
  localStorage.clear();
});
