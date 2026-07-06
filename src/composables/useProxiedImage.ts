import { ref, watch, type Ref } from 'vue'
import { fetchImageBytes } from '@/adapters/cockpitImage'

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
): { url: Ref<string>; failed: Ref<boolean> } {
  const fetchBytes = deps.fetchBytes ?? fetchImageBytes
  const makeUrl = deps.makeUrl ?? ((bytes: Uint8Array) => URL.createObjectURL(new Blob([bytes as BlobPart])))

  const url = ref('')
  const failed = ref(false)

  watch(
    src,
    async (value) => {
      failed.value = false
      if (!value) {
        url.value = ''
        return
      }
      const cached = cache.get(value)
      if (cached) {
        url.value = cached
        return
      }
      try {
        const bytes = await fetchBytes(value)
        const blobUrl = makeUrl(bytes)
        cache.set(value, blobUrl)
        url.value = blobUrl
      } catch {
        failed.value = true
        url.value = ''
      }
    },
    { immediate: true },
  )

  return { url, failed }
}
