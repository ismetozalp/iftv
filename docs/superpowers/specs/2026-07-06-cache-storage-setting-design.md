# In-flight TV — Cache / Storage Setting Design

## Goal
Let the user choose **where** the playback engine writes its HLS segment cache (so it lands on a big disk like `/home`, not a small root fs) and cap **how large** that cache can grow. Motivated by a real incident where test artifacts filled the 70G root fs.

## Background / current state
The engine writes each session's HLS playlist + segments under `cacheRoot(home)` = `~/.cache/inflighttv/<sessionId>/` (`core/media/session.ts`). `adapters/cockpitPlayback.ts` `createCockpitPlaybackEngine()` does `rm -rf <root>` on init (best-effort cleanup of crashed sessions) and each `session.stop()` does `rm -rf <sessionDir>`. Live = rolling window (bounded); VOD = keep-all segments (`-hls_list_size 0`, for seeking), so a long movie's cache ≈ its size (a few GB). Single-connection invariant: exactly one playback session at a time. Settings live in `stores/settings.ts` (JsonStore-backed `settings.json`, already holds `bufferSeconds`/`transcodeMode`/`encoderTest`, with clamp helpers + a Settings UI section pattern).

## Non-goals
- Mid-stream eviction / hard per-moment cap (user chose the simple "prune leftovers" model). A single long movie may briefly exceed the cap while playing.
- Moving the *config* dir (`~/.config/cockpit/inflighttv`) — only the segment CACHE is relocatable.
- Per-account or per-session limits.

## Design

### Settings (2 new fields in `settings.ts`)
- `cacheDir: string` — default `''` = "use the built-in default". When non-empty, the engine writes there.
- `cacheLimitGb: number` — default `5`, clamped `>= 1` (helper `clampCacheLimitGb`, mirroring `clampBufferSeconds`). `PersistedSettings` gains both; `load()` back-fills defaults.

### Cache-root resolution + the ONE safety rule
A pure resolver `resolveCacheRoot(home: string, cacheDir: string): string`:
- `cacheDir` empty → `~/.cache/inflighttv` (unchanged default).
- `cacheDir` set → `<cacheDir>/inflighttv`.

**Non-negotiable:** the app ALWAYS appends its own `inflighttv` subdir to a user-supplied path. The engine `rm -rf`s the root on init and per session; if the root were the user's raw path, pointing it at `/home/ismet/stuff` would let cleanup delete *their* folder. Appending `/inflighttv` guarantees create/delete only ever touch our own subdir. `resolveCacheRoot` is unit-tested for exactly this.

### Size limit — "prune leftovers" (pure selection + DI delete)
Pure `selectDirsToPrune(entries: {id, sizeBytes, mtime}[], limitBytes, keepId): string[]` — returns the ids to delete: if `sum(sizeBytes) > limitBytes`, pick oldest-first (by `mtime`), never `keepId`, until the remaining total ≤ limit. Unit-tested (over-limit picks oldest; under-limit picks none; never returns keepId).

Enforcement runs at **new-session start** (in `engine.start`, after the new session dir id is chosen): list the cache root's child dirs with size+mtime, call `selectDirsToPrune(…, limitBytes, newId)`, `rmrf` the selected. New engine deps (all cockpit-backed in the adapter, faked in tests): `cacheDir(): Promise<string>` (reads the current setting), `cacheLimitBytes(): Promise<number>`, `listSessionDirs(root): Promise<{id,sizeBytes,mtime}[]>`. The existing `rm -rf root` on init stays.

### Wiring (settings → engine, no recreate)
The engine resolves the root + limit **at session start**, via injected getters, so changing the setting takes effect on the next `play()` with no engine recreation. `createCockpitPlaybackEngine()` reads the values through `useSettingsStore()` getters passed as deps (`cacheDir`/`cacheLimitBytes`), keeping `core/` pure. `engine.start` replaces `cacheRoot(await deps.home())` with `resolveCacheRoot(await deps.home(), await deps.cacheDir())`; the init cleanup in the adapter uses the same resolver.

### Validation
On saving a non-empty `cacheDir`, the settings UI action runs `mkdir -p <dir>/inflighttv` + a write-probe (write & delete a temp file) via a cockpit adapter (`probeWritable(path)`). Success → persist. Failure → inline error, keep the previous value. Empty `cacheDir` (default) is always valid.

### UI — new "Cache / storage" Settings section
- **Cache directory**: text input, placeholder = the resolved default (`~/.cache/inflighttv`); helper note "The app writes to `<dir>/inflighttv`."; inline validation error slot.
- **Max cache size (GB)**: number input, default 5, min 1.
- **Current cache size**: readout (compute the root's size via a `dirSizeBytes(path)` adapter), refreshed on open + after Clear.
- **Clear cache now**: button → `rm -rf <resolvedRoot>` (safe: our subdir), then refresh the readout. Guarded so it can't run mid-playback against the active session (or simply clears non-active dirs; v1 clears the whole root when nothing is playing).

## Error handling
- Unwritable/creatable path → validation error, no save (default keeps working).
- Prune/listing failures → best-effort (caught, logged, playback proceeds); never block a session start.
- Missing settings keys on load → defaults back-filled.
- Relocating the path does not migrate existing cache; the old default dir is simply left (cleared on its next use / can be cleared manually).

## Testing
- **Pure (unit):** `resolveCacheRoot` (default vs `<dir>/inflighttv`, incl. the safety-subdir); `selectDirsToPrune` (over/under limit, oldest-first, never keepId); `clampCacheLimitGb`.
- **Store:** settings persist/load `cacheDir`+`cacheLimitGb` (+ back-compat); the save-with-validation action (writable → persists; unwritable → error + unchanged) via injected `probeWritable`.
- **Engine (DI):** `start` writes under the resolved root; prune deletes only over-limit oldest non-active dirs (faked `listSessionDirs`).
- **E2E (real Cockpit, `dev/e2e-*.mjs`):** set a cache dir in Settings → play a movie → assert segments appear under `<dir>/inflighttv/<session>/`; Clear cache empties it. Record in the task report.
- Full `npm test && typecheck && build && test:smoke` per task.

## Rollout (subagent-driven-development)
1. **Core + settings:** `resolveCacheRoot` + `selectDirsToPrune` + `clampCacheLimitGb` (pure, tested) in `core/media/session.ts` (+ a small `core/media/cachePrune.ts`); `settings.ts` fields + validation action (+ tests).
2. **Engine + adapter:** thread `cacheDir`/`cacheLimitBytes`/`listSessionDirs` deps; `engine.start` uses `resolveCacheRoot` + prunes; adapter provides the cockpit-backed deps + `probeWritable`/`dirSizeBytes`; init cleanup uses the resolver.
3. **UI + E2E:** the "Cache / storage" Settings section (dir + size + current-size + Clear), wired to the store; E2E verify segments land in the chosen dir.
