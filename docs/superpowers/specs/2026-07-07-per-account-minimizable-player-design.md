# In-flight TV — Per-Account Player + Minimizable Bar Design

## Goal
Two coupled changes to playback:
1. **Per-account playback** — the single-connection rule is **per account**, not global. Each account tab keeps its own running session; playing a channel on account B no longer stops account A. Within an account, playing another channel replaces that account's one connection.
2. **Minimizable player** — playback can shrink to a **bottom bar strip** (still playing) so the user browses while watching, then restores to full. Modeled on the sibling *explorer* plugin's minimize-to-taskbar UX (adapted: one dock per the active account, not a multi-window taskbar).

## Background / current state
`stores/player.ts` is a **single global session**: state (`status/item/session/duration/startOffset/account/transcode/currentCodec/_forceSoftware/audioTracks/subtitleTracks/selectedAudio/selectedSubtitle`) + a non-reactive `_mx = {lock, gen}` (markRaw) enforcing **one connection globally**. Actions `play/seek/retryWithTranscode/fallbackToSoftware/_restartCurrent/setAudioTrack/setSubtitle/stop/fail` each use the same **mutex+gen single-flight** (a Critical connection-leak here was fixed + reviewed; the 4 restart methods share an identical stop→settle(700ms)→start body). `PlayerView.vue` is one full-screen overlay (`fixed inset:0 z-1050 background:#000`) reading the global store; it owns the `<video>` + hls.js (loader from `session.createLoader()`), the seekbar, audio/CC menus, transcode badge/escalation, live stall handling, EPG strip, and history/progress hooks. Accounts are tabs (`workspace` store, `activeAccount`). Bootstrap 5.3 + theming just landed.

## Non-goals
- No multi-window taskbar (explorer has many files; we have ≤1 session per account). No picture-in-picture API. No re-attach-on-tab-switch logic (we keep videos mounted instead). No global "stop all". No change to the engine/adapters (per-account is a store/UI concern; the engine already takes `(account, item)` per call).

## Architecture

### 1. Player store → per-account slots (`stores/player.ts`)
Replace the flat state with `slots: Record<string, Slot>` keyed by `account.id`.
```
interface Slot {
  accountId: string
  account: Account
  status: 'idle'|'starting'|'playing'|'error'; error: string
  item: ContentItem | null; session: PlaybackSession | null
  duration: number | null; startOffset: number
  transcode: boolean; currentCodec: 'copy'|'nvenc'|'x264'; _forceSoftware: boolean
  audioTracks: AudioTrack[]; subtitleTracks: SubtitleTrack[]; selectedAudio: number; selectedSubtitle: number | null
  minimized: boolean
  _mx: { lock: Promise<unknown>; gen: number } // markRaw — the SAME single-flight, now PER SLOT
}
```
`_slot(account)` get-or-creates the slot. **Every action operates on one slot** and preserves the mutex+gen single-flight EXACTLY as today — just `this.X` → `slot.X` and `this._mx` → `slot._mx`. Signatures gain the target account: `play(account, item, opts)` (already has it); `seek(toSeconds, account = active)`, `setAudioTrack(i, account = active)`, `setSubtitle(i, account = active)`, `stop(account = active)`, `retryWithTranscode(account)`, `fallbackToSoftware(account)`, `_restartCurrent(account)`, `fail(message, account)`. Default `account` = `workspace.activeAccount` for the UI-driven ones. **Slots are independent**: an op on account A never touches account B's slot or `_mx` — two accounts run genuinely concurrently, each single-connection. `stop()` on an account resets its slot to idle (optionally deletes the slot). Consider extracting the shared restart body into `_restart(slot, {offset, transcode?, forceSoftware?})` to DRY seek/retry/fallback/_restartCurrent — but keep the per-slot semantics byte-identical (this is the connection-leak-sensitive core).

**Getters:** `activeSlot` → `slots[workspace.activeAccount?.id]` (or a stable empty slot); `playingSlots` → slots with `status !== 'idle'` (drives `PlayerHost`); back-compat active-slot proxies used by non-PlayerView consumers (`status`, `item`, `account`, `minimized`, …) so `SettingsView` (clear-cache disable), `ContentCard`, etc. keep reading "the current player". `minimize(account=active)`/`restore(account=active)` toggle `slot.minimized`; `play()` and `stop()` reset it to `false`.

### 2. Rendering — `PlayerHost` + per-slot `PlayerView`
- **`components/PlayerHost.vue`** (NEW, mounted once in `App.vue`): `v-for` over `player.playingSlots` → `<PlayerView :account-id="s.accountId" :key="s.accountId" />`. Keying by `accountId` keeps each `<video>` node **stable for that account** — mounted (playing) until that account stops.
- **`PlayerView.vue`** (refactor): takes an `accountId` prop; reads its slot via `player.slots[accountId]`; owns its own `<video>` + hls (session-watch keyed on `slot.session`). All existing chrome/logic operates on the slot. **Presentation by state** (computed from `accountId === workspace.activeAccount?.id` + `slot.minimized`):
  - **active & !minimized** → full overlay (as today), with a new **minimize (—)** button by ✕ Close.
  - **active & minimized** → the bottom bar (below), video as a small thumbnail, audio ON.
  - **non-active** → `display:none`-ish but **kept mounted + muted** (`<video muted>` when not active) so its connection + playback continue silently. Only the active slot's `<video>` is unmuted.
- Muting rule: `video.muted = (accountId !== activeAccountId)`. History/progress/EPG hooks stay per-slot (only meaningful data recorded regardless of visibility).

### 3. Minimizable bottom bar (active + minimized)
A `.iftv-player.minimized` variant: `inset:auto; left:0; right:0; bottom:0; height:~56px; z-index` above content but only the bottom edge — the app behind stays interactive. Layout: small **video thumbnail** (~96×54, the same `<video>`, object-fit cover) · **title** (item name; for live, the EPG now title) · **play/pause** (toggles `video.paused`) · **restore ⤢** (`player.restore()`) · **close ✕** (`player.stop(account)`). The full-screen chrome (seekbar/menus/badge/EPG strip) is `v-if="full"`; the bar chrome is `v-if="minimizedActive"`; the `<video>` is outside both (stable node → uninterrupted playback across the switch).

### 4. App shell coexistence
`App.vue` mounts `<PlayerHost/>` (replaces the single `<PlayerView/>`). When the active account's slot is minimized (or idle) the browse/guide/library UI is fully interactive. Optional: add `padding-bottom` to the shell when any bar is docked so the last row isn't hidden.

## Data flow (per-account concurrency)
`play(A, ch1)` → slot A single-flight start (connection A). User switches to tab B, `play(B, ch2)` → slot B single-flight start (connection B) — **A untouched, still playing muted+hidden**. Switch back to A → A becomes active (unmuted, visible full/bar), B goes hidden+muted (still playing). `stop(A)` → only A's session ends. Within A, `play(A, ch3)` → A's single-flight replaces ch1's session (still one connection to A).

## Error handling
- Per-slot errors are isolated (A's error doesn't affect B). The mutex+gen per slot prevents any two sessions **for the same account** overlapping (the invariant, now per account).
- A crashed/failed slot shows its error in its own PlayerView. `fail(msg, account)` targets one slot.
- Switching to an account with no session → no PlayerView for it (idle). Deleting an account (workspace) should `stop()` its slot first.
- Resource note: N concurrent decodes (one per playing account). Expected small (few accounts); documented, not capped in v1.

## Testing
- **Store (unit, DI mock engine) — the critical part:** preserve every existing single-flight test but PER SLOT; add: two accounts play concurrently → both sessions alive, `maxActive` **per account** ===1 (not global); an op on A never supersedes/stops B; `stop(A)` leaves B playing; switching channel within A replaces only A; `play/seek/retry/fallback/setTrack/stop/fail` interleavings on one slot never leak (maxActive-per-slot===1), mirroring the current tests; `minimize/restore` toggles only that slot and doesn't touch the session.
- **E2E (real Cockpit):** play a channel on the first account → switch to a second account tab → play there → assert BOTH `<video>`s advance (two live connections, one per account) → minimize the active one (bar shows, video still advancing, a browse element behind is clickable) → restore → switch back to the first account (still playing). Confirm switching tabs mutes/unmutes correctly (only one audio).
- Full `npm test && typecheck && build && test:smoke` per task; **whole-branch re-review** of the store refactor (connection-leak-sensitive).

## Rollout (subagent-driven-development)
1. **Store → per-account slots** — `Slot` model + `slots` map + all actions per-slot (identical mutex+gen single-flight) + `minimized`/`minimize`/`restore` + getters (`activeSlot`/`playingSlots`/proxies). Exhaustive per-slot + cross-account tests.
2. **PlayerHost + per-slot PlayerView** — `PlayerHost` renders one `PlayerView` per playing slot; `PlayerView` takes `accountId`, owns its video+hls per slot, visible only for active, muted when non-active; `App.vue` swaps in `PlayerHost`. Update back-compat consumers.
3. **Minimizable bar** — minimize (—)/restore (⤢) buttons + the `.minimized` bottom-bar layout (thumbnail/title/play-pause/restore/close) + shell coexistence.
4. **E2E + final whole-branch review** — the concurrency + minimize E2E above; re-review the store.
