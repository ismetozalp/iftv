export type ByteReader = (path: string) => Promise<Uint8Array | null>
export type PathResolver = (url: string) => string

interface Cb {
  onSuccess(resp: { url: string; data: string | ArrayBuffer }, stats: unknown, context: unknown, nd: unknown): void
  onError(err: { code: number; text: string }, context: unknown, nd: unknown, stats: unknown): void
  onTimeout?(stats: unknown, context: unknown, nd: unknown): void
  onProgress?(stats: unknown, context: unknown, data: unknown, nd: unknown): void
}
interface Ctx {
  url: string
  responseType: string
  rangeStart?: number
  rangeEnd?: number
}

function newStats() {
  return {
    aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0,
    loading: { start: 0, first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 },
  }
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// Build an hls.js-compatible loader class that reads bytes via `readFile` instead
// of the network. Used as `pLoader`/`fLoader` in the Hls config.
export function createCockpitLoaderClass(readFile: ByteReader, resolvePath: PathResolver) {
  return class CockpitLoader {
    context: Ctx | null = null
    stats = newStats()
    private aborted = false

    load(context: Ctx, _config: unknown, callbacks: Cb): void {
      this.context = context
      this.aborted = false
      this.stats = newStats()
      this.stats.loading.start = now()
      const path = resolvePath(context.url)
      readFile(path)
        .then((data) => {
          if (this.aborted) return
          if (data == null) {
            callbacks.onError({ code: 404, text: 'not found' }, context, null, this.stats)
            return
          }
          let bytes = data
          if (context.rangeEnd) bytes = data.subarray(context.rangeStart ?? 0, context.rangeEnd)
          const s = this.stats
          s.loading.first = now()
          s.loading.end = now()
          s.loaded = s.total = bytes.byteLength
          const out: string | ArrayBuffer =
            context.responseType === 'arraybuffer'
              ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
              : new TextDecoder().decode(bytes)
          callbacks.onSuccess({ url: context.url, data: out }, s, context, null)
        })
        .catch((e) => {
          if (this.aborted) return
          callbacks.onError({ code: 0, text: String(e) }, context, null, this.stats)
        })
    }

    abort(): void {
      this.aborted = true
      this.stats.aborted = true
    }

    destroy(): void {
      this.abort()
      this.context = null
    }
  }
}
