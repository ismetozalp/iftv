declare module 'cockpit' {
  interface CockpitHttpOptions {
    address?: string
    port?: number
    tls?: Record<string, unknown>
    superuser?: 'require' | 'try'
  }
  interface CockpitHttpRequest extends Promise<string> {
    stream(cb: (data: string) => void): CockpitHttpRequest
    response(cb: (status: number, headers: Record<string, string>) => void): CockpitHttpRequest
  }
  interface CockpitHttpClient {
    get(path: string, params?: Record<string, string>, headers?: Record<string, string>): CockpitHttpRequest
    post(path: string, body?: unknown, headers?: Record<string, string>): CockpitHttpRequest
  }
  interface CockpitFileHandle<T> {
    read(): Promise<T | null>
    replace(content: T | null, expectedTag?: string): Promise<string>
    modify(cb: (current: T | null) => T | null): Promise<string>
    watch(cb: (content: T | null, tag: string) => void): { remove(): void }
    close(): void
  }
  interface CockpitUser {
    id: number; gid: number; name: string; full_name: string
    home: string; shell: string; groups: string[]
  }
  interface CockpitSpawnOptions { superuser?: 'require' | 'try'; err?: 'message' | 'out'; binary?: boolean }
  interface CockpitSpawnBinaryOptions extends CockpitSpawnOptions { binary: true }
  interface Cockpit {
    http(endpoint: string | number | CockpitHttpOptions): CockpitHttpClient
    file<T = string>(path: string, options?: { syntax?: { parse(s: string): T; stringify(o: T): string }; binary?: boolean; superuser?: 'require' | 'try' }): CockpitFileHandle<T>
    spawn(argv: string[], options: CockpitSpawnBinaryOptions): Promise<Uint8Array> & { stream(cb: (data: Uint8Array) => void): unknown }
    spawn(argv: string[], options?: CockpitSpawnOptions): Promise<string> & { stream(cb: (data: string) => void): unknown }
    user(): Promise<CockpitUser>
    location: { go(path: string): void; path: string[] }
  }
  const cockpit: Cockpit
  export default cockpit
}

interface Window { cockpit: import('cockpit').default }
