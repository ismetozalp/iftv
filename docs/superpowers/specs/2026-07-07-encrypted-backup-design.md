# In-flight TV — Encrypted Backup / Restore Design

## Goal
Let the user **export** their configuration to a single password-encrypted file (browser download) and **import** it back on the same or another machine. v1 is **local file only** — no cloud, no network, no provider (a deliberate scope decision).

## Background / current state
Vue3/Pinia/Bootstrap Cockpit plugin. User config lives under `~/.config/cockpit/inflighttv/` as JSON files, each owned by a store via `JsonStore` (`core/storage/appState.ts`: `load<T>(name, fallback)` / `save<T>(name, value)`; `adapters/cockpitFile.ts` `createCockpitStore()` reads/writes them through `cockpit.file(path,{syntax:JSON})`). Files present: `accounts.json` (Xtream/M3U accounts **incl. credentials**), `settings.json`, `library.json` (Plan 4 collections), `tabs.json` (open account tabs), plus `epg.json` (re-fetchable EPG cache). Web Crypto (`crypto.subtle`) is available in the Cockpit iframe AND the Node/vitest test env → the crypto core is real-testable. Settings UI (`views/settings/SettingsView.vue`) already has sectioned panels (buffer/transcode/cache/EPG).

## Non-goals
- No cloud/remote/Claude backup (explicitly deferred by the user). No auto/scheduled backup. No selective/partial restore or merge (full replace only). No password recovery (lost password = unrecoverable, by design). No plaintext export (encrypted only). `epg.json` and the segment cache are NOT backed up (re-derivable).

## Architecture

### 1. Core (`core/backup/`, pure — uses Web Crypto via `globalThis.crypto`, node-testable; no cockpit/DOM)
**`bundle.ts`**
- `BACKUP_FILES = ['accounts.json','settings.json','library.json','tabs.json'] as const`.
- `buildBundle(files: Record<string, unknown>, exportedAt: number): string` → plaintext JSON `{ app:'inflighttv', kind:'backup', version:1, exportedAt, files }`.
- `parseBundle(plaintext: string): { version:number; exportedAt:number; files: Record<string,unknown> }` — JSON.parse + validate `app==='inflighttv' && kind==='backup'` and `files` is an object; throws a clear error otherwise (so a decrypted-but-wrong blob is rejected).

**`crypto.ts`** (envelope = a JSON string with base64 fields)
- `encryptBackup(plaintext: string, password: string): Promise<string>`:
  - random 16-byte `salt`, 12-byte `iv`;
  - `PBKDF2(SHA-256, iterations=600000, salt)` from the password → 256-bit `AES-GCM` key;
  - encrypt UTF-8(plaintext) → ciphertext;
  - return `JSON.stringify({ app:'inflighttv', kind:'backup-enc', v:1, kdf:{name:'PBKDF2',hash:'SHA-256',iterations:600000,salt:b64}, cipher:'AES-GCM', iv:b64, ct:b64 })`.
- `decryptBackup(envelopeJson: string, password: string): Promise<string>`:
  - parse + validate envelope shape/version; re-derive the key from `password`+`salt`+`iterations`; `AES-GCM` decrypt → UTF-8 plaintext.
  - **GCM auth failure (wrong password / tampered) throws** — the caller maps it to a friendly message.
- Base64 helpers for `Uint8Array` ⇄ string (pure).

### 2. Adapter (`adapters/cockpitBackup.ts`)
- `gatherFiles(store): Promise<Record<string, unknown>>` — for each `BACKUP_FILES`, `store.load(name, null)`; include only non-null (a fresh install may lack `library.json`/`tabs.json`).
- `restoreFiles(store, files): Promise<void>` — for each key in `files` that is in `BACKUP_FILES`, `store.save(name, value)` (ignore unknown keys defensively).
- `downloadTextFile(name: string, text: string): void` — `Blob([text],{type:'application/octet-stream'})` → `URL.createObjectURL` → transient `<a download=name>` click → revoke. (Works inside the Cockpit iframe — same-origin blob.)
- `readUploadedFile(file: File): Promise<string>` — `FileReader.readAsText`.

### 3. UI — Settings "Backup & restore" section (`SettingsView.vue`)
- **Export:** a password field + confirm field (or a small inline form) → on Export, require the two match + non-empty → `buildBundle(await gatherFiles(store), Date.now())` → `encryptBackup(..., password)` → `downloadTextFile('inflighttv-backup-YYYY-MM-DD.iftv', envelope)`. Show "Downloaded." Clear the password fields after.
- **Import:** `<input type="file" accept=".iftv,application/octet-stream">` + a password field → on Import: `readUploadedFile` → `decryptBackup(envelope, password)` → `parseBundle` → **confirm dialog** ("This will REPLACE your accounts, settings, library and tabs with the backup. Continue?") → `restoreFiles(store, files)` → `location.reload()`.
- **Errors** (inline, non-blocking): decrypt/validate failure → *"Incorrect password or not a valid In-flight TV backup file."*; empty password → prompt to enter; mismatched confirm → *"Passwords don't match."*
- A one-line caution: *"Keep this file and its password safe — the file contains your account credentials (encrypted), and a lost password can't be recovered."*

## Data flow
Export: `gatherFiles → buildBundle(plaintext JSON) → encryptBackup(envelope JSON) → downloadTextFile(.iftv)`.
Import: `readUploadedFile → decryptBackup(plaintext) → parseBundle(files) → confirm → restoreFiles → location.reload()`.

## Error handling
- Wrong password / tampered / non-backup file → thrown by `decryptBackup`/`parseBundle` → friendly inline error, nothing written.
- Missing source file during gather → skipped (only present files are bundled).
- `restoreFiles` writes each file; a mid-write failure surfaces an error (best-effort; the confirm makes it an explicit user action). Reload happens only after all writes resolve.
- Malformed envelope JSON → caught, friendly error.

## Security notes
- Credentials are only ever written to disk **encrypted** (AES-256-GCM); the plaintext bundle exists only in memory during export. 600k PBKDF2 iterations resists brute force. Random per-export salt+iv. No password/keys logged. The `.iftv` file is the user's to safeguard.

## Testing
- **Core (unit, node Web Crypto):** `encryptBackup`→`decryptBackup` round-trips the exact plaintext; **wrong password throws**; a tampered `ct`/`iv` throws (GCM); envelope carries the expected kdf params; base64 helpers round-trip binary. `buildBundle`/`parseBundle` round-trip; `parseBundle` rejects non-backup / malformed JSON / missing `files`.
- **Adapter (DI, memory store):** `gatherFiles` collects present files, skips absent; `restoreFiles` writes back exactly (round-trip via a memory store); unknown keys ignored.
- **E2E (real Cockpit, `dev/e2e-*.mjs`):** Settings → Export with a password → a `.iftv` file downloads (assert file exists + is non-empty + not plaintext-readable); then Import that file with the same password → confirm → app reloads → the same account(s) present. Wrong-password import → error shown, nothing changed. (No network — pure local.) Record in the task report.
- Full `npm test && typecheck && build && test:smoke` per task.

## Rollout (subagent-driven-development)
1. **Core:** `core/backup/{bundle,crypto}.ts` (+ exhaustive tests: round-trip, wrong-password, tamper, validation, base64).
2. **Adapter + UI + E2E:** `adapters/cockpitBackup.ts` (gather/restore/download/read); Settings "Backup & restore" section (export/import forms, confirm, errors, caution); E2E export→import round-trip.
