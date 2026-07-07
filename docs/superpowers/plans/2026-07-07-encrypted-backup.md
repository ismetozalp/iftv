# In-flight TV — Plan: Encrypted Backup / Restore

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Export config to a password-encrypted `.iftv` file (download) + import to restore (full replace). Local only. Spec: `docs/superpowers/specs/2026-07-07-encrypted-backup-design.md`.

**Architecture:** Pure `core/backup/` (bundle + Web-Crypto encrypt/decrypt). `adapters/cockpitBackup.ts` (gather/restore via JsonStore + browser download/upload). Settings "Backup & restore" section.

**Tech Stack:** unchanged (Vue3/Vite/TS/Bootstrap/Pinia/Vitest; Web Crypto via `globalThis.crypto` — present in Node test env + the Cockpit iframe).

## Global Constraints
- Branch `feat/backup` (off `main`). `src/core/**` pure (Web Crypto ok, NO cockpit/DOM/Date.now — times passed in); cockpit/DOM only in the adapter/UI. TDD; per-task commit; merge to `main`.
- Encrypted-only, full-REPLACE restore, no password recovery. Backs up exactly `accounts.json`/`settings.json`/`library.json`/`tabs.json`. Credentials only ever serialized ENCRYPTED.
- Never log passwords/keys/plaintext.

## File Structure
- `src/core/backup/bundle.ts` — build/parse plaintext bundle. NEW (+test)
- `src/core/backup/crypto.ts` — encrypt/decrypt envelope + base64. NEW (+test)
- `src/adapters/cockpitBackup.ts` — gather/restore/download/read. NEW
- `src/views/settings/SettingsView.vue` — "Backup & restore" section.

---

### Task 1: Core — bundle + crypto (pure, Web-Crypto, node-tested)

**Files:** create `src/core/backup/bundle.ts` (+`bundle.test.ts`), `src/core/backup/crypto.ts` (+`crypto.test.ts`).

- [ ] **Step 1 — bundle test** `bundle.test.ts`:
```ts
import { buildBundle, parseBundle, BACKUP_FILES } from './bundle'
it('builds a versioned bundle and round-trips', () => {
  const files = { 'accounts.json': { accounts: [{ id: 'a' }] }, 'settings.json': { bufferSeconds: 30 } }
  const json = buildBundle(files, 1720000000000)
  const b = parseBundle(json)
  expect(b.version).toBe(1); expect(b.exportedAt).toBe(1720000000000); expect(b.files).toEqual(files)
})
it('parseBundle rejects a non-backup / malformed blob', () => {
  expect(() => parseBundle('{"hello":1}')).toThrow()
  expect(() => parseBundle('not json')).toThrow()
  expect(() => parseBundle(JSON.stringify({ app: 'inflighttv', kind: 'backup', version: 1, exportedAt: 0 }))).toThrow() // no files
})
it('BACKUP_FILES is the 4 config files (no epg cache)', () => {
  expect(BACKUP_FILES).toEqual(['accounts.json', 'settings.json', 'library.json', 'tabs.json'])
})
```
- [ ] **Step 2 — implement `bundle.ts`:** `export const BACKUP_FILES = ['accounts.json','settings.json','library.json','tabs.json'] as const`; `buildBundle(files, exportedAt)` → `JSON.stringify({ app:'inflighttv', kind:'backup', version:1, exportedAt, files })`; `parseBundle(text)` → JSON.parse (catch → throw `new Error('Not a valid backup file')`), assert `o.app==='inflighttv' && o.kind==='backup'` and `o.files && typeof o.files==='object'` else throw, return `{ version, exportedAt, files }`. RED→GREEN.
- [ ] **Step 3 — crypto test** `crypto.test.ts` (real Web Crypto in node):
```ts
import { encryptBackup, decryptBackup } from './crypto'
it('round-trips plaintext with the right password', async () => {
  const env = await encryptBackup('secret-data-💾', 'hunter2')
  expect(env).not.toContain('secret-data') // ciphertext, not plaintext
  expect(await decryptBackup(env, 'hunter2')).toBe('secret-data-💾')
})
it('wrong password throws', async () => {
  const env = await encryptBackup('x', 'right')
  await expect(decryptBackup(env, 'wrong')).rejects.toThrow()
})
it('tampered ciphertext throws (GCM auth)', async () => {
  const env = JSON.parse(await encryptBackup('x', 'p')); env.ct = env.ct.slice(0, -4) + 'AAAA'
  await expect(decryptBackup(JSON.stringify(env), 'p')).rejects.toThrow()
})
it('envelope carries kdf params + is not plaintext', async () => {
  const env = JSON.parse(await encryptBackup('hello', 'p'))
  expect(env).toMatchObject({ kind: 'backup-enc', v: 1, cipher: 'AES-GCM', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000 } })
  expect(env.salt && env.iv && env.ct).toBeTruthy()
})
it('two exports of the same data differ (random salt+iv)', async () => {
  expect(await encryptBackup('x', 'p')).not.toBe(await encryptBackup('x', 'p'))
})
```
- [ ] **Step 4 — implement `crypto.ts`** using `globalThis.crypto.subtle`:
  - `const enc = new TextEncoder(); const dec = new TextDecoder()`; base64 helpers `b64(bytes: Uint8Array): string` (`btoa(String.fromCharCode(...))` chunked for large inputs) / `unb64(s): Uint8Array` (present in node+browser).
  - `deriveKey(password, salt, iterations)`: `importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])` → `deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations}, base, {name:'AES-GCM',length:256}, false, ['encrypt','decrypt'])`.
  - `encryptBackup(plaintext, password)`: `salt=crypto.getRandomValues(new Uint8Array(16))`, `iv=…(12)`, key=derive, `ct=await subtle.encrypt({name:'AES-GCM',iv}, key, enc.encode(plaintext))` → return JSON envelope (all bytes b64).
  - `decryptBackup(envJson, password)`: parse; validate `kind==='backup-enc' && v===1` (else throw `'Not a valid backup file'`); derive with the envelope's `salt`+`iterations`; `subtle.decrypt` (throws on auth fail — let it propagate) → `dec.decode`.
  RED→GREEN.
- [ ] **Step 5 — gate + commit.** `git commit -am "feat(backup): pure bundle + PBKDF2/AES-GCM encrypt-decrypt core (Web Crypto, node-tested)"`

---

### Task 2: Adapter + Settings UI + E2E

**Files:** create `src/adapters/cockpitBackup.ts`; modify `src/views/settings/SettingsView.vue`; add `dev/e2e-backup.mjs`.

- [ ] **Step 1 — adapter `cockpitBackup.ts`:**
```ts
import type { JsonStore } from '@/core/storage/appState'
import { createCockpitStore } from '@/adapters/cockpitFile'
import { BACKUP_FILES } from '@/core/backup/bundle'
export async function gatherFiles(store?: JsonStore): Promise<Record<string, unknown>> {
  const s = store ?? await createCockpitStore(); const out: Record<string, unknown> = {}
  for (const name of BACKUP_FILES) { const v = await s.load<unknown>(name, null); if (v != null) out[name] = v }
  return out
}
export async function restoreFiles(files: Record<string, unknown>, store?: JsonStore): Promise<void> {
  const s = store ?? await createCockpitStore()
  for (const name of BACKUP_FILES) { if (name in files) await s.save(name, files[name]) }
}
export function downloadTextFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }))
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}
export function readUploadedFile(file: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(file) })
}
```
(Optional light adapter test for gather/restore round-trip via a memory store — call `gatherFiles(mem)`/`restoreFiles(files, mem)`.)
- [ ] **Step 2 — Settings "Backup & restore" section** in `SettingsView.vue` (mirror existing section markup). Script: refs `exportPw`, `exportPw2`, `importPw`, `importFile: File|null`, `backupMsg`, `backupError`. Handlers:
  - `onExport()`: if `!exportPw` → error "Enter a password"; if `exportPw!==exportPw2` → "Passwords don't match"; else `const env = await encryptBackup(buildBundle(await gatherFiles(), Date.now()), exportPw)`; `downloadTextFile('inflighttv-backup-'+ymd()+'.iftv', env)`; `backupMsg='Backup downloaded.'`; clear pw fields. (`ymd()` = local YYYY-MM-DD.)
  - `onImportFile(e)`: set `importFile` from the input.
  - `onImport()`: guard file+pw; `const text = await readUploadedFile(importFile)`; `try { const plain = await decryptBackup(text, importPw); const { files } = parseBundle(plain) } catch → backupError='Incorrect password or not a valid In-flight TV backup file.'; return`; `if (!confirm('This will REPLACE your accounts, settings, library and tabs with the backup. Continue?')) return`; `await restoreFiles(files); window.location.reload()`.
  Template: an **Export** row (2 password inputs + Export button + `backupMsg`), an **Import** row (`<input type="file" accept=".iftv,application/octet-stream" @change="onImportFile">` + password input + Import button), `backupError` in `.text-danger`, and the caution line: "Keep this file and its password safe — it holds your account credentials (encrypted) and a lost password can't be recovered."
- [ ] **Step 3 — gate + commit.** `git commit -am "feat(backup): cockpit gather/restore + download/upload adapter + Settings 'Backup & restore' (export/import, replace, confirm)"`
- [ ] **Step 4 — E2E** (`dev/e2e-backup.mjs`, real Cockpit): Settings → fill both export passwords → Export → capture the download (Playwright `page.on('download')`), assert the saved file is non-empty and does NOT contain a known cleartext (e.g. the account's password/username string) → then set the Import file to that path + the password → Import → accept the confirm dialog → app reloads → the account is still present (or, to avoid destroying state, assert decrypt succeeds + parseBundle yields the 4 files by reading the downloaded file in the harness). Wrong-password import → error shown. Record in the task report. (Local only — no network.)

---

## Self-Review
- **Spec coverage:** bundle+crypto (T1), adapter+UI+E2E (T2). Encrypted-only, full-replace, no-recovery all reflected.
- **Types/wiring:** `BACKUP_FILES`/`buildBundle`/`parseBundle`/`encryptBackup`/`decryptBackup` (T1) consumed by the adapter+UI (T2).
- **Security:** plaintext bundle only in memory; disk artifact always AES-GCM encrypted; 600k PBKDF2; random salt+iv per export; no logging of secrets; wrong-password/tamper → thrown → friendly message.
- **Purity/no-regression:** `core/backup/**` pure (Web Crypto only, times injected); additive UI; restore writes the 4 files then reloads; nothing else changes.
