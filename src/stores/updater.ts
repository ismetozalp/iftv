import { defineStore } from 'pinia'
import { APP_VERSION } from '@/core/version'
import { normalizeRepo, isNewer, DEFAULT_REPO } from '@/core/update/release'
import { cockpitUpdate, type UpdateAdapter, type LatestRelease } from '@/adapters/cockpitUpdate'
import { useSettingsStore } from '@/stores/settings'

export const useUpdaterStore = defineStore('updater', {
  state: () => ({
    checking: false,
    installing: false,
    current: APP_VERSION,
    latest: null as LatestRelease | null,
    available: false,
    error: '',
    log: [] as string[],
    _adapter: cockpitUpdate as UpdateAdapter,
  }),
  getters: {
    // The configured repo, normalized to "owner/repo" (settings.updateRepo added in the settings store).
    repo(): string {
      const raw = (useSettingsStore() as unknown as { updateRepo?: string }).updateRepo ?? DEFAULT_REPO
      return normalizeRepo(raw)
    },
  },
  actions: {
    $configure(adapter: UpdateAdapter) {
      this._adapter = adapter
    },
    async check(manual: boolean) {
      if (this.checking || this.installing) return
      this.checking = true
      this.error = ''
      try {
        const rel = await this._adapter.fetchLatestRelease(this.repo)
        this.latest = rel
        this.available = !!rel && !!this.current && isNewer(rel.version, this.current)
        if (manual && !rel) this.error = `No releases found at ${this.repo}.`
      } catch (e) {
        // Clear any prior result so the UI never shows "update available" alongside an error.
        this.latest = null
        this.available = false
        if (manual) this.error = e instanceof Error ? e.message : String(e)
      } finally {
        this.checking = false
      }
    },
    async update() {
      if (this.installing || this.checking || !this.latest) return
      const target = this.latest // pin the tag/version for the whole download+install
      this.installing = true
      this.error = ''
      this.log = []
      try {
        const zip = await this._adapter.downloadReleaseZip(this.repo, target.tag)
        await this._adapter.runInstall(zip, target.version, (line) => this.log.push(line))
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        this.error = msg
        this.log.push(`error: ${msg}`)
      } finally {
        this.installing = false
      }
    },
    startupCheck() {
      void this.check(false)
    },
  },
})
