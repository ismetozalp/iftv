<script setup lang="ts">
import { ref, watch } from 'vue'
import cockpit from 'cockpit'
import { useSettingsStore, DEFAULT_EPG_URL } from '@/stores/settings'
import { usePlayerStore } from '@/stores/player'
import { useEpgStore } from '@/stores/epg'
import { resolveCacheRoot } from '@/core/media/session'
import { cacheSizeBytes, clearCache } from '@/adapters/cockpitCache'
import { gatherFiles, restoreFiles, downloadTextFile, readUploadedFile } from '@/adapters/cockpitBackup'
import { buildBundle, parseBundle } from '@/core/backup/bundle'
import { encryptBackup, decryptBackup } from '@/core/backup/crypto'
import type { TranscodeMode } from '@/core/media/encoder'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()
const player = usePlayerStore()
const epg = useEpgStore()

function onInput(e: Event) {
  const n = Number((e.target as HTMLInputElement).value)
  void settings.setBufferSeconds(n)
}

function onTranscodeModeChange(e: Event) {
  const m = (e.target as HTMLSelectElement).value as TranscodeMode
  void settings.setTranscodeMode(m)
}

function onTestEncoders() {
  void settings.runEncoderTest(Date.now())
}

// Cache / storage
const cacheDirInput = ref(settings.cacheDir)
const cacheError = ref('')
const cacheSizeLabel = ref('')
const defaultRoot = ref('')
const resolvedRoot = ref('')

function formatBytes(n: number): string {
  const gb = n / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}

async function refreshCache() {
  // Sync the input from the (possibly async-loaded) store each time the panel opens — the ref's
  // initial value is snapshotted at app boot, before settings.load() resolves, so without this a
  // saved custom dir would show blank and Save would silently revert it to default.
  cacheDirInput.value = settings.cacheDir
  const home = (await cockpit.user()).home
  defaultRoot.value = `${home}/.cache/inflighttv`
  resolvedRoot.value = resolveCacheRoot(home, settings.cacheDir)
  const b = await cacheSizeBytes(resolvedRoot.value)
  cacheSizeLabel.value = formatBytes(b)
}

// TV Guide (EPG)
const epgUrlInput = ref(settings.epgUrl)
const epgError = ref('')

function formatRelative(ms: number): string {
  if (!ms) return 'never'
  const diffSec = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (diffSec < 60) return 'just now'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.round(diffHr / 24)}d ago`
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      void refreshCache()
      // Same rationale as cacheDirInput: re-sync from the store on each open so a saved value
      // isn't clobbered by a stale ref snapshotted before settings.load() resolved at boot.
      epgUrlInput.value = settings.epgUrl
    }
  },
  { immediate: true },
)

async function onSaveCacheDir() {
  const r = await settings.setCacheDir(cacheDirInput.value)
  cacheError.value = r.ok ? '' : (r.error ?? 'Invalid')
  if (r.ok) await refreshCache()
}

async function onCacheLimit(e: Event) {
  await settings.setCacheLimitGb(Number((e.target as HTMLInputElement).value))
  await refreshCache()
}

async function onClearCache() {
  await clearCache(resolvedRoot.value)
  await refreshCache()
}

async function onSaveEpgUrl() {
  const r = await settings.setEpgUrl(epgUrlInput.value)
  epgError.value = r.ok ? '' : (r.error ?? 'Invalid')
}

async function onRefreshEpgNow() {
  await epg.refresh()
}

// Backup & restore
const exportPw = ref('')
const exportPw2 = ref('')
const importPw = ref('')
const importFile = ref<File | null>(null)
const backupMsg = ref('')
const backupError = ref('')

function ymd(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

async function onExport() {
  backupError.value = ''
  backupMsg.value = ''
  if (!exportPw.value) {
    backupError.value = 'Enter a password'
    return
  }
  if (exportPw.value !== exportPw2.value) {
    backupError.value = "Passwords don't match"
    return
  }
  try {
    const env = await encryptBackup(buildBundle(await gatherFiles(), Date.now()), exportPw.value)
    downloadTextFile(`inflighttv-backup-${ymd()}.iftv`, env)
    backupMsg.value = 'Backup downloaded.'
    exportPw.value = ''
    exportPw2.value = ''
  } catch {
    backupError.value = 'Could not create the backup.'
  }
}

function onImportFile(e: Event) {
  importFile.value = (e.target as HTMLInputElement).files?.[0] ?? null
}

async function onImport() {
  backupError.value = ''
  if (!importFile.value || !importPw.value) return
  const text = await readUploadedFile(importFile.value)
  let files: Record<string, unknown>
  try {
    const plain = await decryptBackup(text, importPw.value)
    files = parseBundle(plain).files
  } catch {
    backupError.value = "Incorrect password or not a valid In-flight TV backup file."
    importPw.value = ''
    return
  }
  if (!confirm('This will REPLACE your accounts, settings, library and tabs with the backup. Continue?')) return
  try {
    await restoreFiles(files)
  } catch {
    backupError.value = 'Restore failed while writing files — nothing may be reloaded.'
    return
  }
  window.location.reload()
}

function close() {
  emit('close')
}
</script>

<template>
  <div v-if="open" class="iftv-detail">
    <div class="iftv-detail-card" style="max-width: 420px">
      <button class="btn btn-sm btn-light iftv-detail-close" @click="close">✕ Close</button>
      <h4>Settings</h4>
      <div class="mt-3">
        <label for="iftv-buffer-seconds" class="form-label">Buffer seconds</label>
        <input
          id="iftv-buffer-seconds"
          type="number"
          class="form-control"
          min="5"
          max="120"
          step="5"
          :value="settings.bufferSeconds"
          @change="onInput"
        />
        <p class="text-muted small mt-2 mb-0">
          Seconds of video to buffer before/while playing — higher = smoother, more delay.
        </p>
      </div>
      <div class="mt-3">
        <label for="iftv-transcode-mode" class="form-label">Video transcoding</label>
        <select
          id="iftv-transcode-mode"
          class="form-select"
          :value="settings.transcodeMode"
          @change="onTranscodeModeChange"
        >
          <option value="auto">Auto</option>
          <option value="gpu">GPU (NVENC)</option>
          <option value="software">Software (x264)</option>
          <option value="off">Off</option>
        </select>
        <div class="d-flex align-items-center gap-2 mt-2">
          <button class="btn btn-sm btn-outline-secondary" @click="onTestEncoders">Test encoders</button>
          <span class="text-muted small">
            <template v-if="settings.encoderTest">
              NVENC {{ settings.encoderTest.nvenc ? '✅' : '✗' }} · x264 {{ settings.encoderTest.x264 ? '✅' : '✗' }}
            </template>
            <template v-else>not tested</template>
          </span>
        </div>
        <p class="text-muted small mt-2 mb-0">
          Transcode video to H.264 on the host when the browser can't decode it (e.g. HEVC).
        </p>
      </div>
      <div class="mt-3">
        <h5>Cache / storage</h5>
        <label for="iftv-cache-dir" class="form-label">Cache directory</label>
        <div class="d-flex align-items-center gap-2">
          <input
            id="iftv-cache-dir"
            class="form-control"
            :placeholder="defaultRoot"
            v-model="cacheDirInput"
          />
          <button class="btn btn-sm btn-outline-secondary" @click="onSaveCacheDir">Save</button>
        </div>
        <small class="text-muted">
          Writes to <code>{{ cacheDirInput.trim() ? cacheDirInput.trim().replace(/\/+$/, '') + '/inflighttv' : defaultRoot }}</code>
        </small>
        <div class="text-danger small" v-if="cacheError">{{ cacheError }}</div>
        <label for="iftv-cache-limit" class="form-label mt-3">Max cache size (GB)</label>
        <input
          id="iftv-cache-limit"
          type="number"
          min="1"
          class="form-control"
          :value="settings.cacheLimitGb"
          @change="onCacheLimit"
        />
        <div class="d-flex align-items-center gap-2 mt-2">
          <span class="text-muted small">Current cache: {{ cacheSizeLabel }}</span>
          <button
            class="btn btn-sm btn-outline-secondary"
            :disabled="player.status !== 'idle'"
            @click="onClearCache"
          >
            Clear cache now
          </button>
        </div>
      </div>
      <div class="mt-3">
        <h5>TV Guide (EPG)</h5>
        <label for="iftv-epg-url" class="form-label">EPG URL (XMLTV, optional gzip)</label>
        <div class="d-flex align-items-center gap-2">
          <input
            id="iftv-epg-url"
            class="form-control"
            :placeholder="DEFAULT_EPG_URL"
            v-model="epgUrlInput"
          />
          <button class="btn btn-sm btn-outline-secondary" @click="onSaveEpgUrl">Save</button>
        </div>
        <small class="text-muted">Leave empty to disable the TV guide.</small>
        <div class="text-danger small" v-if="epgError">{{ epgError }}</div>
        <div class="d-flex align-items-center gap-2 mt-2">
          <button class="btn btn-sm btn-outline-secondary" :disabled="epg.loading" @click="onRefreshEpgNow">
            {{ epg.loading ? 'Refreshing…' : 'Refresh now' }}
          </button>
          <span class="text-muted small">
            Last updated: {{ formatRelative(epg.loadedAt) }} · {{ Object.keys(epg.index).length }} channels
          </span>
        </div>
        <div class="text-danger small" v-if="epg.error">{{ epg.error }}</div>
      </div>
      <div class="mt-3">
        <h5>Backup & restore</h5>
        <label for="iftv-export-pw" class="form-label">Export — encryption password</label>
        <div class="d-flex align-items-center gap-2">
          <input
            id="iftv-export-pw"
            type="password"
            class="form-control"
            placeholder="Password"
            v-model="exportPw"
          />
          <input
            id="iftv-export-pw2"
            type="password"
            class="form-control"
            placeholder="Confirm password"
            v-model="exportPw2"
          />
          <button class="btn btn-sm btn-outline-secondary" @click="onExport">Export backup</button>
        </div>
        <small class="text-muted" v-if="backupMsg">{{ backupMsg }}</small>
        <label for="iftv-import-file" class="form-label mt-3">Import — backup file</label>
        <div class="d-flex align-items-center gap-2">
          <input
            id="iftv-import-file"
            type="file"
            class="form-control"
            accept=".iftv,application/octet-stream"
            @change="onImportFile"
          />
          <input
            id="iftv-import-pw"
            type="password"
            class="form-control"
            placeholder="Password"
            v-model="importPw"
          />
          <button class="btn btn-sm btn-outline-secondary" @click="onImport">Import backup</button>
        </div>
        <div class="text-danger small" v-if="backupError">{{ backupError }}</div>
        <small class="text-muted d-block mt-2">
          Keep this file and its password safe — it holds your account credentials (encrypted) and a lost password
          can't be recovered.
        </small>
      </div>
    </div>
  </div>
</template>
