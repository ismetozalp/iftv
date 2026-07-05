import type { JsonStore } from '@/core/storage/appState'
import type { XtreamTransport } from '@/core/xtream/transport'
import { createCockpitStore } from '@/adapters/cockpitFile'
import { createCockpitTransport } from '@/adapters/cockpitHttp'

let cached: { store: JsonStore; transport: XtreamTransport } | null = null

export async function useHost(): Promise<{ store: JsonStore; transport: XtreamTransport }> {
  if (!cached) {
    cached = { store: await createCockpitStore(), transport: createCockpitTransport() }
  }
  return cached
}
