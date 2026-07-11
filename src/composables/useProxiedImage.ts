import { ref, watch, type Ref } from 'vue'
import { fetchImageBytes } from '@/adapters/cockpitImage'
import { createLimiter } from '@/core/util/concurrencyLimit'

// Cap concurrent logo/poster fetches across the WHOLE app. Each fetch is a host-side
// `cockpit.spawn(curl)`; a big M3U grid (thousands of channels, external logos) would otherwise
// fire dozens at once and — together with an active playback session's cockpit I/O — flood the
// Cockpit bridge and crash the renderer. 6 mirrors a browser's per-host connection limit.
const imageLimiter = createLimiter(6)

export interface UseProxiedImageDeps {
  fetchBytes?: (url: string) => Promise<Uint8Array>
  makeUrl?: (bytes: Uint8Array) => string
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

  const url = ref('')
  const failed = ref(false)
  // True while a poster is actually being fetched (queued behind the limiter → decoded). Drives the
  // card's loading shimmer. A cached hit or a missing src is never "loading" (nothing to wait for).
  const loading = ref(false)

  watch(
    src,
    async (value) => {
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
        const bytes = await imageLimiter.run(() => fetchBytes(value))
        const blobUrl = makeUrl(bytes)
        cache.set(value, blobUrl)
        url.value = blobUrl
      } catch {
        failed.value = true
        url.value = ''
      } finally {
        loading.value = false
      }
    },
    { immediate: true },
  )

  return { url, failed, loading }
}
