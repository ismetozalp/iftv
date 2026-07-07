import { defineStore } from 'pinia'
import type { JsonStore } from '@/core/storage/appState'
import { createCockpitStore } from '@/adapters/cockpitFile'
import { detectEncoders } from '@/adapters/cockpitEncoders'
import { probeWritable as cockpitProbeWritable } from '@/adapters/cockpitCache'
import type { EncoderTest, TranscodeMode } from '@/core/media/encoder'
import { THEME_MODES, type ThemeMode } from '@/core/theme'

const DEFAULT_BUFFER_SECONDS = 30
const MIN_BUFFER_SECONDS = 5
const MAX_BUFFER_SECONDS = 120
const DEFAULT_TRANSCODE_MODE: TranscodeMode = 'auto'
const TRANSCODE_MODES: TranscodeMode[] = ['auto', 'gpu', 'software', 'off']
const DEFAULT_THEME_MODE: ThemeMode = 'system'
const DEFAULT_CACHE_LIMIT_GB = 5
const MIN_CACHE_LIMIT_GB = 1
export const DEFAULT_EPG_URL = 'https://epgshare01.online/epgshare01/epg_ripper_TR1.xml.gz'
export const EPG_TTL_MS = 12 * 3600 * 1000
const EPG_URL_RE = /^https?:\/\//

interface Deps {
  store: JsonStore
  detect?: () => Promise<{ nvenc: boolean; x264: boolean }>
  probeWritable?: (dir: string) => Promise<boolean>
}

interface PersistedSettings {
  bufferSeconds: number
  transcodeMode: TranscodeMode
  encoderTest: EncoderTest | null
  cacheDir: string
  cacheLimitGb: number
  epgUrl: string
  themeMode: ThemeMode
}

function clampBufferSeconds(n: number): number {
  return Math.min(MAX_BUFFER_SECONDS, Math.max(MIN_BUFFER_SECONDS, n))
}

function clampCacheLimitGb(n: number): number {
  return Math.max(MIN_CACHE_LIMIT_GB, Math.floor(n) || DEFAULT_CACHE_LIMIT_GB)
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    bufferSeconds: DEFAULT_BUFFER_SECONDS,
    transcodeMode: DEFAULT_TRANSCODE_MODE as TranscodeMode,
    encoderTest: null as EncoderTest | null,
    cacheDir: '' as string,
    cacheLimitGb: DEFAULT_CACHE_LIMIT_GB,
    epgUrl: DEFAULT_EPG_URL as string,
    themeMode: DEFAULT_THEME_MODE as ThemeMode,
    _deps: null as Deps | null,
  }),
  actions: {
    $configure(deps: Deps) {
      this._deps = deps
    },
    async _host(): Promise<Deps> {
      if (!this._deps) this._deps = { store: await createCockpitStore(), detect: detectEncoders }
      return this._deps
    },
    async _persist() {
      const { store } = await this._host()
      const value: PersistedSettings = {
        bufferSeconds: this.bufferSeconds,
        transcodeMode: this.transcodeMode,
        encoderTest: this.encoderTest,
        cacheDir: this.cacheDir,
        cacheLimitGb: this.cacheLimitGb,
        epgUrl: this.epgUrl,
        themeMode: this.themeMode,
      }
      await store.save('settings.json', value)
    },
    async load() {
      const { store } = await this._host()
      const loaded = await store.load('settings.json', {
        bufferSeconds: DEFAULT_BUFFER_SECONDS,
        transcodeMode: DEFAULT_TRANSCODE_MODE,
        encoderTest: null as EncoderTest | null,
        cacheDir: '',
        cacheLimitGb: DEFAULT_CACHE_LIMIT_GB,
        epgUrl: DEFAULT_EPG_URL,
        themeMode: DEFAULT_THEME_MODE,
      })
      this.bufferSeconds = clampBufferSeconds(loaded.bufferSeconds)
      this.transcodeMode = loaded.transcodeMode ?? DEFAULT_TRANSCODE_MODE
      this.encoderTest = loaded.encoderTest ?? null
      this.cacheDir = loaded.cacheDir ?? ''
      this.cacheLimitGb = clampCacheLimitGb(loaded.cacheLimitGb ?? DEFAULT_CACHE_LIMIT_GB)
      this.epgUrl = loaded.epgUrl ?? DEFAULT_EPG_URL
      const loadedThemeMode = loaded.themeMode ?? DEFAULT_THEME_MODE
      this.themeMode = THEME_MODES.includes(loadedThemeMode) ? loadedThemeMode : DEFAULT_THEME_MODE
    },
    async setBufferSeconds(n: number) {
      this.bufferSeconds = clampBufferSeconds(n)
      await this._persist()
    },
    async setTranscodeMode(m: TranscodeMode) {
      if (!TRANSCODE_MODES.includes(m)) throw new Error(`invalid transcode mode: ${String(m)}`)
      this.transcodeMode = m
      await this._persist()
    },
    async setThemeMode(m: ThemeMode) {
      if (!THEME_MODES.includes(m)) return
      this.themeMode = m
      await this._persist()
    },
    async runEncoderTest(now = 0) {
      const { detect } = await this._host()
      const result = await (detect ?? detectEncoders)()
      this.encoderTest = { nvenc: result.nvenc, x264: result.x264, testedAt: now }
      await this._persist()
    },
    async setCacheLimitGb(n: number) {
      this.cacheLimitGb = clampCacheLimitGb(n)
      await this._persist()
    },
    // Validate a chosen dir before persisting: empty = default (always ok); else probe writable.
    async setCacheDir(dir: string): Promise<{ ok: boolean; error?: string }> {
      const d = dir.trim()
      if (d) {
        if (!d.startsWith('/')) return { ok: false, error: 'Use an absolute path (starting with /)' }
        const { probeWritable } = await this._host()
        const ok = await (probeWritable ?? cockpitProbeWritable)(d)
        if (!ok) return { ok: false, error: 'Directory is not writable' }
      }
      this.cacheDir = d
      await this._persist()
      return { ok: true }
    },
    // '' disables EPG fetching; otherwise must look like an http(s) URL.
    async setEpgUrl(url: string): Promise<{ ok: boolean; error?: string }> {
      const u = url.trim()
      if (u && !EPG_URL_RE.test(u)) return { ok: false, error: 'Use a valid http(s) URL' }
      this.epgUrl = u
      await this._persist()
      return { ok: true }
    },
  },
})
