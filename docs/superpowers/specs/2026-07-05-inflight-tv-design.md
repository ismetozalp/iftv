# In-flight TV — Design Spec

**Date:** 2026-07-05
**Status:** Approved design, pre-implementation
**License:** Apache-2.0 (selected on GitHub at first release; no `LICENSE` file committed until then)

## 1. Overview

In-flight TV is a **Cockpit plugin** (a standalone Cockpit package, sibling in convention to the
existing `explorer` plugin but an independent project and GitHub repo) that acts as an
**Xtream Codes IPTV client** watchable through the browser. The user supplies an Xtream
**URL, username, and password**; the app then browses and plays **Live TV, VOD (movies),
and Series**, with **EPG**, and layers on personal organization features (favorites, custom
lists, watch-later, continue-watching, history) and **encrypted cloud backup** of that state.

The name is a play on Cockpit ("in-flight"); it is **not** intended for aircraft/offline use.

### Goals
- Log into one or more Xtream Codes providers and browse Live / VOD / Series with EPG.
- Reliable in-browser playback despite CORS + mixed-content constraints.
- Personal organization: favorites, multiple named custom lists, watch-later, continue-watching, history.
- Global search across all content; searchable/sortable watch-later.
- Encrypted, restorable backup of all app state — a downloadable local file (export/import via Settings) and, later, cloud providers.
- GPU-accelerated transcoding with device selection.
- Clean, modular, feature-sliced codebase (no monolithic files).

### Non-goals (explicitly out of scope)
- Catch-up / archive (timeshift) playback.
- Adult-content PIN / parental lock.
- Aircraft / offline operation.
- Recording / DVR.

## 2. Tech stack

| Concern | Choice |
|---|---|
| UI framework | **Vue 3** (runtime-only build) |
| Build tool | **Vite** |
| Language | **TypeScript** |
| Styling | **Bootstrap 5** + custom CSS for media/player UI |
| State | **Pinia** (thin stores) |
| Routing | **vue-router** |
| Live TS / HLS playback | **hls.js** (fed from local ffmpeg HLS output) |
| Transcode/remux | **ffmpeg** on the host, driven via `cockpit.spawn` |
| Host integration | `cockpit.http` (metadata), `cockpit.spawn` (ffmpeg + detection), `cockpit.file` (persistence) |
| Crypto | Web Crypto (PBKDF2-SHA256 → AES-256-GCM) |
| Tests | Vitest (unit), Playwright (smoke) |
| Packaging | `manifest.json` + Makefile (build → install → `gh release`), like explorer |

## 3. Architecture

All logic lives inside one Cockpit package. Layers:

```
Vue 3 SPA (Cockpit iframe)
  views: Live · VOD · Series · EPG · Search · Watch Later · Favorites/Lists ·
         History · Settings · Backup · Player
├── Metadata     : cockpit.http → player_api.php   (server-side fetch, no CORS)
├── Media engine : cockpit.spawn → ffmpeg → rolling HLS files;
│                  cockpit.file → custom hls.js loader → <video>
├── Persistence  : cockpit.file → ~/.config/cockpit/inflighttv/*.json
└── Backup       : StorageProvider + Web Crypto (cloud calls via cockpit.http)
Host provides: ffmpeg, DRM render nodes / NVENC (GPU)
```

### 3.1 Metadata
The Xtream JSON API is fetched through **`cockpit.http()`**, which runs the request in the
server-side bridge. This sidesteps CORS and Cockpit's auto-injected `block-all-mixed-content`,
so both the API and channel logos work without widening CSP to remote hosts.

### 3.2 Media engine (the novel component)
Playing the actual streams must defeat two browser walls: **CORS** (MSE players fetch bytes via
JS; Xtream sends no `Access-Control-Allow-Origin`) and **mixed content** (Cockpit is HTTPS,
Xtream is usually plain HTTP). Chosen approach — **Cockpit-native ffmpeg, no daemon:**

1. User selects content → app builds the Xtream stream URL
   (`/live/{u}/{p}/{id}.ts`, `/movie/.../{id}.{ext}`, `/series/.../{episode_id}.{ext}`).
2. App runs `cockpit.spawn(['ffmpeg', …])`. ffmpeg fetches the upstream itself (server-side →
   no CORS/mixed-content), **remuxes** when codecs are browser-friendly (near-zero cost) or
   **transcodes** (GPU per Hardware Settings, software fallback) when not, writing a rolling
   **HLS playlist + segments** into `~/.cache/inflighttv/<session>/`.
3. A **custom hls.js loader** reads the `.m3u8` + segments via `cockpit.file(binary)` and feeds
   them to the `<video>` element as same-origin blobs (CSP stays `media-src 'self' blob:`).
4. On stop/navigate/close/error, the app kills the ffmpeg PID and cleans the session dir.

**Session lifecycle:** each playback = one tracked ffmpeg PID with guaranteed teardown; cap of
one live + one VOD session at a time; stale session dirs garbage-collected on startup. VOD
seeking restarts ffmpeg at an offset (`-ss`).

**Swap-ability:** the engine sits behind a `PlaybackEngine` interface, so a companion-daemon
implementation could replace it later without touching any view. (Accepted tradeoff of the
chosen approach: ~6–15s live latency and the custom-loader plumbing.)

### 3.3 Hardware acceleration
ffmpeg GPU transcoding, with device selection in a **Hardware Settings** panel:
- **Detection** via `cockpit.spawn`: `ffmpeg -hwaccels`, `ls /dev/dri/render*`, `nvidia-smi -L`,
  `vainfo --device /dev/dri/renderDXX`.
- **NVIDIA** → NVENC/NVDEC (`-hwaccel cuda -hwaccel_device N`, `h264_nvenc`/`hevc_nvenc`).
- **Intel/AMD** → VAAPI/QSV via DRM render node (`/dev/dri/renderD12x`, `h264_vaapi`/`h264_qsv`).
- User picks method + specific card; **automatic software fallback** (`libx264`) when none is
  chosen or HW fails. GPU only engages on the **transcode** path — pure remux needs no GPU.

### 3.4 Persistence
Account-scoped state stored as JSON via `cockpit.file(..., {syntax: JSON})` in
`~/.config/cockpit/inflighttv/`, using `.modify()` for safe concurrent writes and `.watch()` to react to
external edits. `localStorage` only for ephemeral per-browser scraps (volume, last tab).

### 3.5 Backup
Provider-agnostic: state is serialized, **encrypted client-side**, then handed as an opaque blob
to a `StorageProvider`. Cloud API calls route through `cockpit.http` where helpful to avoid
browser CORS. First provider is redirect-free; others plug in behind the same interface.

## 4. File structure (feature-sliced, no monolithic files)

```
inflight-tv/
  manifest.json · index.html · vite.config.ts · tsconfig.json · package.json
  Makefile · VERSION · README.md · cockpit.d.ts
  src/
    main.ts · App.vue · router.ts · cockpit.ts          # bootstrap + cockpit shim
    core/                                                # framework-agnostic (no Vue)
      xtream/  client.ts live.ts vod.ts series.ts epg.ts types.ts normalize.ts
      media/   PlaybackEngine.ts ffmpegEngine.ts hlsCockpitLoader.ts session.ts hwaccel.ts
      storage/ appState.ts schema.ts
      backup/  crypto.ts StorageProvider.ts githubProvider.ts backupService.ts
      accounts/ accounts.ts tabs.ts
    stores/    workspace.ts library.ts favorites.ts lists.ts watchLater.ts
               continueWatching.ts history.ts settings.ts player.ts
    views/     live/ vod/ series/ epg/ search/ watchlater/ lists/ history/
               settings/ backup/ player/
    components/                                          # shared UI (PosterCard, Grid, …)
    composables/  useSearch.ts useSort.ts useVirtualList.ts
    styles/
  tests/       unit/ (vitest) · smoke.mjs (playwright)
  docs/superpowers/specs/2026-07-05-inflight-tv-design.md
```

**Principle:** each file has one clear purpose and a defined interface. Core logic stays out of
Vue components so it is unit-testable in isolation. If a file grows large, it is split.

## 5. Data model

Persisted JSON files in `~/.config/cockpit/inflighttv/`. Personal data is **namespaced per account**
because content IDs are not portable across providers.

**`accounts.json`** (registry only — no active/open state)
```jsonc
{
  "accounts": [
    { "id": "acc_1", "name": "My Provider", "url": "http://host:8080",
      "username": "u", "password": "p", "createdAt": 1751731200 }
  ]
}
```
Passwords are stored here (user's own home dir, file mode 600; Xtream requires them in every
request). A future "don't persist password" toggle is possible but not in the first version.

**`tabs.json`** (explorer-style account tabs — which accounts are open, and which is focused)
```jsonc
{ "openTabIds": ["acc_1", "acc_2"], "activeTabId": "acc_1" }
```
One tab per opened account; opening/closing a tab is separate from adding/removing an account
(closing a tab does NOT delete the account). Open tabs + active tab persist across reloads. When
exactly one account exists, it is auto-opened. The accounts core is registry-only; a separate
tabs module owns open/active state.

**`data-<accountId>.json`**
```jsonc
{
  "favorites": [ { "type": "live", "id": "123" } ],
  "lists": [ { "id": "list_1", "name": "Kids", "items": [ { "type": "movie", "id": "9" } ] } ],
  "watchLater": [ { "type": "movie", "id": "9", "addedAt": 1751731200 },
                  { "type": "episode", "id": "88", "seriesId": "5", "addedAt": 1751731200 } ],
  "progress": { "movie:9": { "positionSecs": 540, "durationSecs": 5400, "updatedAt": 1751731200 } },
  "history": [ { "type": "episode", "id": "88", "watchedAt": 1751731200 } ]
}
```
- `type` ∈ `live | movie | series | episode` (VOD films are `movie`; `series` refers to a whole
  series, `episode` to one episode).
- `history` is a capped append log (cap TBD in plan, e.g. last 500).

**`settings.json`** (global, not per-account)
```jsonc
{
  "theme": "auto",
  "hwaccel": { "method": "none|vaapi|qsv|nvenc", "device": "/dev/dri/renderD128" },
  "player": { "defaultVolume": 1.0, "subtitleLang": null, "audioLang": null },
  "epg": { "cacheTtlSecs": 3600 }
}
```

## 6. Feature → mechanism mapping

| Feature | Mechanism |
|---|---|
| Live / VOD / Series browse | `core/xtream/*` via `cockpit.http`; cached in `library` store |
| EPG | `get_short_epg` per channel on demand (base64-decoded), TTL-cached; optional `xmltv.php` grid later |
| Favorites | `{type,id}` refs in `data-<acct>.json`, resolved against `library` |
| Custom lists | multiple named lists of `{type,id}` refs |
| Watch Later | refs + `addedAt`; view filters Movies/Series/Both, searchable + sortable (`useSearch`/`useSort`) |
| Continue Watching | `progress` map keyed by `type:id`; resume via ffmpeg `-ss`; home row |
| History | capped append log |
| Global search | client-side over cached Live/VOD/Series metadata (`useSearch`), one box all sections |
| Multi-account | `accounts` registry (`accounts.json`); active account = the active tab's account; per-account data in `data-<id>.json` |
| Account tabs | explorer-style: one tab per opened account, open/close ≠ add/remove, persisted `tabs.json`, single account auto-opens; `core/accounts/tabs.ts` + `AccountTabBar` |
| Player essentials | audio/subtitle track select, quality, keyboard shortcuts, fullscreen/PiP |
| Hardware settings | GPU detect + method/device selection + software fallback |
| Backup (local file) | encrypt state → `Blob` → browser download; Settings upload → decrypt → restore (same crypto envelope, no provider) |
| Backup (cloud) | encrypt → `StorageProvider` (GitHub PAT first); list/restore |

## 7. Xtream API reference (implementation targets)

- **Login:** `GET /player_api.php?username=&password=` → treat OK only if
  `user_info.auth === 1 && user_info.status === "Active"`. Prefer `server_info` protocol/port.
- **Live:** `get_live_categories`, `get_live_streams[&category_id=]`; play `/live/{u}/{p}/{stream_id}.ts`.
- **VOD:** `get_vod_categories`, `get_vod_streams[&category_id=]`, `get_vod_info&vod_id=`;
  play `/movie/{u}/{p}/{stream_id}.{container_extension}`.
- **Series:** `get_series_categories`, `get_series[&category_id=]`, `get_series_info&series_id=`
  (episodes keyed by season number; episode `id` + `container_extension`);
  play `/series/{u}/{p}/{episode_id}.{container_extension}`.
- **EPG:** `get_short_epg&stream_id=[&limit=]`, `get_simple_data_table&stream_id=`, `/xmltv.php`.
  **`title`/`description` are base64-encoded** in JSON EPG — decode before display.
- **Robustness:** fields arrive as inconsistent types (numbers/booleans as strings); panels
  rate-limit. `core/xtream/normalize.ts` coerces types and null-guards; the client caches
  aggressively and backs off. Use `direct_source` when non-empty. Choose VOD/episode extension
  from `container_extension` (never guess).

## 8. Packaging, build & CSP

- **Vite:** `base: './'`, `modulePreload.polyfill: false`, `external: ['cockpit']`, Vue
  runtime-only, `cssCodeSplit: false`, predictable output names. `vite-plugin-static-copy` copies
  `manifest.json`; `vite-plugin-compression` writes `.gz` siblings.
- **`cockpit.js`:** loaded via `<script src="../base1/cockpit.js">`; `import cockpit from 'cockpit'`
  aliased to `window.cockpit` with a `cockpit.d.ts`.
- **manifest.json:** `requires.cockpit: "215"`, `tools.index → index.html` (Tools → InFlight TV).
- **CSP:**
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; worker-src 'self' blob:; object-src 'self'`
  (tuned during dev if hls.js's worker needs `script-src blob:`).
- **Makefile:** `make install` = `npm ci && npm run build` then copy `dist/` →
  `/usr/share/cockpit/inflighttv`; `make zip` / `make publish` produce a release zip and push a
  `gh release` tagged from `VERSION`, mirroring explorer.

## 9. ffmpeg dependency & setup

On first run the app probes `ffmpeg -version` via `cockpit.spawn`. If missing, a **setup screen**
detects the package manager (dnf/apt/…) and offers a one-click install
(`cockpit.spawn` with `superuser: "require"`), with manual instructions as fallback. The same
probe drives Hardware Settings GPU detection.

## 10. Encrypted backup (local file + cloud)

- **Crypto (`core/backup/crypto.ts`):** PBKDF2-SHA256, ≥600,000 iterations, random 16-byte salt →
  AES-256-GCM with a fresh random 12-byte IV. Self-describing envelope:
  ```json
  { "v": 1, "kdf": "PBKDF2-SHA256", "iter": 600000, "salt": "<b64>", "iv": "<b64>", "ct": "<b64>" }
  ```
  The password never leaves the browser; wrong password fails the GCM tag → clean error. The same
  envelope is used for both the local-file and cloud paths.
- **Local encrypted backup file (export / import) — the simplest path, no provider needed:**
  - **Export:** serialize all app state → encrypt to the envelope above with a user-entered
    password → wrap as a `Blob` → trigger a **browser download** (`<a download>` of an
    `inflighttv-backup-<date>.iftv` file). No cloud, no network.
  - **Import / restore:** in **Settings**, the user picks a previously downloaded file (`<input type=file>`),
    enters the password, the app decrypts + validates the envelope and restores the state (wrong
    password → clean "wrong password" error; unrecognized/corrupt file → clean error).
  - This is the **first backup deliverable** and reuses the crypto layer directly (it is effectively
    a `FileDownloadProvider`/`FileUploadProvider` with no remote calls).
- **`StorageProvider` interface (cloud):** `connect()`, `list()`, `put(name, blob)`, `get(name)`,
  `delete(name)`. Crypto sits above it — providers only ever see ciphertext.
- **First provider — GitHub fine-grained PAT:** redirect-free, `api.github.com` is CORS-friendly,
  no app review; user pastes a repo-scoped PAT once. Backups PUT via the Contents API; list/restore
  via the same API. A **backups view** lists existing envelopes with restore/delete.
- **Later providers:** Dropbox (OAuth PKCE + app-folder, via a hosted popup callback), Nextcloud/
  WebDAV (app-password), etc. Google Drive is deferred (its OAuth redirect rules reject LAN IPs and
  bare hostnames). Same interface throughout.

## 11. Testing

- **Vitest unit tests** on pure `core/` modules (cockpit shim mocked): `xtream/normalize.ts`
  (type coercion, null-guards, base64 EPG decode), `backup/crypto.ts` (encrypt→decrypt round-trip,
  wrong-password rejection), `media/hwaccel.ts` (device→flag builder), `media/hlsCockpitLoader.ts`
  (playlist parsing).
- **Playwright smoke test** against the built package: loads, renders shell, add-account form
  validates, no console errors.
- Video E2E requires a real Xtream account, so the Xtream client is mocked in tests
  (`MockXtreamClient`); real playback validated manually during dev.

## 12. Dev workflow

```bash
ln -s /home/ismet/inFlightTV/dist ~/.local/share/cockpit/inflighttv
npx vite build --watch     # rebuilds dist/ on save; reload the Cockpit tab
```
`cockpit-bridge --packages` confirms Cockpit sees `inflighttv`. No `vite dev` (HMR breaks CSP).

## 13. Open items deferred to the implementation plan

- Exact ffmpeg argument sets per path (live remux, live transcode per vendor, VOD remux/transcode, `-ss` seek).
- HLS segment/target-duration tuning for the latency/stability tradeoff.
- History cap value and pruning policy.
- Precise CSP tuning once hls.js's worker behavior is observed.
- Player UI: subtitle/audio track discovery from ffmpeg probe vs. Xtream metadata.
```
