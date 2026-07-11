import { ref, watch, type Ref } from 'vue'
import { fetchImageBytes } from '@/adapters/cockpitImage'
import { readCachedPoster, writeCachedPoster } from '@/adapters/cockpitPosterCache'
import { createLimiter } from '@/core/util/concurrencyLimit'

// Cap concurrent NETWORK poster fetches across the WHOLE app. Each is a host-side `cockpit.spawn(curl)`;
// a big M3U grid (thousands of channels, external logos) would otherwise fire dozens at once and —
// together with an active playback session's cockpit I/O — flood the Cockpit bridge and crash the
// renderer. With the persistent disk cache most loads are now cheap local reads (not throttled), so
// only genuine cache-miss fetches hit this limiter; 10 keeps the miss path responsive while bounded.
const imageLimiter = createLimiter(10)

export interface UseProxiedImageDeps {
  fetchBytes?: (url: string) => Promise<Uint8Array>
  makeUrl?: (bytes: Uint8Array) => string
  readDisk?: (url: string) => Promise<Uint8Array | null>
  writeDisk?: (url: string, bytes: Uint8Array) => Promise<void>
}

// Cache blob URLs by source URL so the same poster/logo isn't refetched (and its blob: URL
// isn't recreated) every time a component re-renders. Never revoked: posters are reused
// across the app's lifetime and cockpit plugin sessions are short-lived (a full page reload
// tears everything down anyway).
const cache = new Map<string, string>()

export function useProxiedImage(
  src: () => string | null | undefined,
  deps: UseProxiedImageDeps = {},
): { url: Ref<string>; failed: Ref<boolean>; loading: Ref<boolean> } {
  const fetchBytes = deps.fetchBytes ?? fetchImageBytes
  const makeUrl = deps.makeUrl ?? ((bytes: Uint8Array) => URL.createObjectURL(new Blob([bytes as BlobPart])))
  const readDisk = deps.readDisk ?? readCachedPoster
  const writeDisk = deps.writeDisk ?? writeCachedPoster

  const url = ref('')
  const failed = ref(false)
  // True while a poster is actually being fetched (queued behind the limiter → decoded). Drives the
  // card's loading shimmer. A cached hit or a missing src is never "loading" (nothing to wait for).
  const loading = ref(false)

  // Each src change bumps `gen`; an async fetch only writes state if it's still the latest one, so a
  // fast scroll / reactive swap can't have a slow earlier fetch clobber a newer poster.
  let gen = 0
  watch(
    src,
    async (value) => {
      const my = ++gen
      failed.value = false
      if (!value) {
        url.value = ''
        loading.value = false
        return
      }
      const cached = cache.get(value)
      if (cached) {
        url.value = cached
        loading.value = false
        return
      }
      url.value = ''
      loading.value = true
      try {
        // Disk cache first (fast local read, not network-throttled). On a miss, fetch from the remote
        // host through the limiter and populate the disk cache for next time (best-effort, non-blocking).
        let bytes = await readDisk(value)
        if (!bytes) {
          bytes = await imageLimiter.run(() => fetchBytes(value))
          void writeDisk(value, bytes)
        }
        const blobUrl = makeUrl(bytes)
        cache.set(value, blobUrl)
        if (my !== gen) return // superseded by a newer src — cache it, but don't clobber newer state
        url.value = blobUrl
      } catch {
        if (my === gen) {
          failed.value = true
          url.value = ''
        }
      } finally {
        if (my === gen) loading.value = false
      }
    },
    { immediate: true },
  )

  return { url, failed, loading }
}
