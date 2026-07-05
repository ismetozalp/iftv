export interface JsonStore {
  load<T>(name: string, fallback: T): Promise<T>
  save<T>(name: string, value: T): Promise<void>
}

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T)
}

export function createMemoryStore(seed: Record<string, unknown> = {}): JsonStore {
  const data: Record<string, unknown> = clone(seed)
  return {
    async load<T>(name: string, fallback: T): Promise<T> {
      return name in data ? clone(data[name] as T) : fallback
    },
    async save<T>(name: string, value: T): Promise<void> {
      data[name] = clone(value)
    },
  }
}
