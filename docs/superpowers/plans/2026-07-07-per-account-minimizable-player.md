# In-flight TV — Plan: Per-Account Player + Minimizable Bar

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Per-account playback (each account tab keeps its own single connection, concurrent) + a minimizable bottom bar. Spec: `docs/superpowers/specs/2026-07-07-per-account-minimizable-player-design.md`.

**Architecture:** `stores/player.ts` refactors from one global session to `slots: Record<accountId, Slot>`, each with its OWN mutex+gen single-flight (identical semantics, per slot). `PlayerHost` renders one `PlayerView` per playing slot; only the active is visible+unmuted. `.minimized` docks the same `<video>` to a bottom bar.

**Tech Stack:** unchanged (Vue3/Vite/TS/Bootstrap 5.3/Pinia/Vitest).

## Global Constraints
- Branch `feat/per-account-player` (off `main`). TDD; per-task commit; merge to `main`.
- **CONNECTION-LEAK-SENSITIVE CORE.** The mutex+gen single-flight (a Critical leak was fixed + reviewed here) must be preserved EXACTLY, now PER SLOT. Invariant: for any ONE account, ≤1 session ever alive (maxActive-per-account===1); different accounts are independent and may each have a session. No action on account A may stop/supersede/touch account B's slot or its `_mx`.
- Minimize is pure UI (a `<video>` reposition) — never restarts/stops a session. `<video>` nodes stay mounted (keyed by accountId) so playback is uninterrupted.

## File Structure
- `src/stores/player.ts` — per-account slots refactor. (+player.test.ts rewrite)
- `src/components/PlayerHost.vue` — renders a PlayerView per playing slot. NEW
- `src/components/PlayerView.vue` — takes `accountId`, per-slot video+hls, visible/minimized/hidden.
- `src/App.vue` — swap `<PlayerView>` → `<PlayerHost>`.
- `src/styles/app.css` — `.iftv-player.minimized` bottom-bar styles.
- back-compat consumers reading `player.status`/`player.item` (SettingsView clear-cache guard, ContentCard, GuideView) — verify against active-slot proxies / add `anyPlaying`.

---

### Task 1: Player store → per-account slots (the core refactor)

**Files:** rewrite `src/stores/player.ts`; rewrite/extend `src/stores/player.test.ts`.

- [ ] **Step 1 — Slot model + state.** Define:
```ts
interface Slot {
  accountId: string; account: Account
  status: 'idle'|'starting'|'playing'|'error'; error: string
  item: ContentItem|null; session: PlaybackSession|null
  duration: number|null; startOffset: number
  transcode: boolean; currentCodec: 'copy'|'nvenc'|'x264'; _forceSoftware: boolean
  audioTracks: AudioTrack[]; subtitleTracks: SubtitleTrack[]; selectedAudio: number; selectedSubtitle: number|null
  minimized: boolean
  _mx: { lock: Promise<unknown>; gen: number }
}
function emptySlot(account: Account): Slot { return markRaw({ accountId: account.id, account, status:'idle', error:'', item:null, session:null, duration:null, startOffset:0, transcode:false, currentCodec:'copy', _forceSoftware:false, audioTracks:[], subtitleTracks:[], selectedAudio:0, selectedSubtitle:null, minimized:false, _mx:{lock:Promise.resolve(),gen:0} }) }
```
State: `slots: {} as Record<string, Slot>`, `_deps`. NOTE: markRaw the whole Slot so the `_mx` promise-chain isn't made reactive (matches the current markRaw of `_mx`); slot FIELDS the UI needs reactive (status/item/minimized/…) — to keep reactivity, DON'T markRaw the slot; instead keep `_mx` markRaw INSIDE a reactive slot (as today `_mx` is markRaw within reactive state). So: `emptySlot` returns a plain object whose `_mx` is `markRaw({lock,gen})`; slots map is reactive; `slot._mx` stays non-reactive. Verify UI reactivity in Task 2.
- [ ] **Step 2 — helpers.** `_slot(account): Slot` → `this.slots[account.id] ??= emptySlot(account)` (assign into the reactive map). `_exclusive(slot, fn)` → same as today but on `slot._mx`. `_resolveVideoCodec(slot)`, `_startWithFallback(slot, account, item, opts)` (sets `slot._forceSoftware`), `_probe` (unchanged, pure per-call).
- [ ] **Step 3 — restart helper (DRY the 4 identical bodies).** Extract:
```ts
async _restart(slot: Slot, opts: { offsetSeconds: number; setTranscode?: boolean; forceSoftware?: boolean }) {
  const gen = ++slot._mx.gen
  await this._exclusive(slot, async () => {
    if (gen !== slot._mx.gen) return
    const { account, item } = slot; if (!account || !item) return
    if (opts.setTranscode) slot.transcode = true
    if (opts.forceSoftware) slot._forceSoftware = true
    const bufferSeconds = useSettingsStore().bufferSeconds
    const s = slot.session; slot.session = null
    if (s) await s.stop()
    await this.sleep(SETTLE_MS)
    if (gen !== slot._mx.gen) return
    try {
      const session = await this._startWithFallback(slot, account, item, { bufferSeconds, startOffsetSeconds: opts.offsetSeconds, videoCodec: this._resolveVideoCodec(slot), audioIndex: slot.selectedAudio, subtitleIndex: slot.selectedSubtitle })
      if (gen !== slot._mx.gen) { await session.stop(); return }
      slot.session = session; slot.startOffset = opts.offsetSeconds; slot.currentCodec = this._resolveVideoCodec(slot); slot.status = 'playing'
    } catch (e) { if (gen === slot._mx.gen) { slot.status='error'; slot.error = e instanceof Error?e.message:String(e); slot.session=null } }
  })
}
```
Then `seek(t, account=active)` → `_restart(slot, {offsetSeconds: clamp(t)})`; `retryWithTranscode(account=active)` → guard off-mode then `_restart(slot,{offsetSeconds:slot.startOffset,setTranscode:true})`; `fallbackToSoftware(account=active)` → guard nvenc then `_restart(slot,{offsetSeconds:slot.startOffset,forceSoftware:true})`; `_restartCurrent(slot)` → `_restart(slot,{offsetSeconds:slot.startOffset})`.
- [ ] **Step 4 — play/stop/fail per slot.** `play(account, item, opts)` → `const slot=this._slot(account)`; `const gen=++slot._mx.gen`; exclusive on slot; reset slot fields (minimized=false); the same probe→start body but on `slot`. `stop(account=active)` / `fail(msg, account=active)` → `++slot._mx.gen`, exclusive, reset the slot (stop keeps or removes the slot — set status idle + clear). `setAudioTrack(i, account=active)`/`setSubtitle(i, account=active)` set slot fields then `_restartCurrent(slot)`. `minimize(account=active)`/`restore(account=active)` set `slot.minimized`.
- [ ] **Step 5 — getters.** `activeSlot(state)` via `useWorkspaceStore().activeAccount` → `state.slots[id]` (or a frozen idle sentinel); `playingSlots` → `Object.values(state.slots).filter(s=>s.status!=='idle')`; `anyPlaying` → `playingSlots.length>0`; back-compat proxies `status`/`item`/`account`/`duration`/`startOffset`/`currentCodec`/`transcode`/`minimized`/`error`/`audioTracks`/`subtitleTracks`/`selectedAudio`/`selectedSubtitle` → from `activeSlot`. `session`/`sourceUrl` proxies too if any consumer needs them.
- [ ] **Step 6 — tests (REWRITE player.test.ts).** Keep EVERY existing single-flight scenario but on one account's slot (maxActive-per-slot===1: rapid seeks coalesce, play-during-seek no leak, stop-during-seek→idle, etc.). ADD cross-account:
```ts
it('two accounts play concurrently — both sessions alive, one connection EACH', async () => {
  // engine counts active per accountId; assert maxActive-per-account===1 AND both accounts active===1 simultaneously
})
it('an op on account A never stops/supersedes account B', async () => { /* play A, play B, seek A → B.session unchanged, B.status playing */ })
it('stop(A) leaves B playing', ...)
it('switching channel within A replaces only A (A single-flight), B untouched', ...)
it('minimize/restore(account) toggles only that slot.minimized, never touches the session', ...)
```
Use a per-account active-count harness (a Map<accountId,count> incremented in start / decremented in stop) to prove per-account maxActive===1 and true concurrency.
- [ ] **Step 7 — gate + commit.** `git commit -am "refactor(player): per-account slots — session/state/mutex+gen keyed by accountId; each account single-connection + independent (concurrent). +minimize/restore. DRY restart body"`

---

### Task 2: PlayerHost + per-slot PlayerView

**Files:** create `src/components/PlayerHost.vue`; refactor `src/components/PlayerView.vue`; modify `src/App.vue`; verify back-compat consumers.

- [ ] **Step 1 — PlayerHost.vue:** `v-for="s in player.playingSlots" :key="s.accountId"` → `<PlayerView :account-id="s.accountId" />`. Mount once in `App.vue` (replace the single `<PlayerView/>`; remove the old direct mount).
- [ ] **Step 2 — PlayerView.vue refactor:** add prop `accountId: string`. Read `const slot = computed(() => player.slots[props.accountId])`. Replace every `player.X`/`player.session`/etc. with `slot.value.X`, and every action call with the account-targeted form (`player.seek(t, slot.value.account)`, `player.setSubtitle(i, slot.value.account)`, `player.stop(slot.value.account)`, `player.minimize(slot.value.account)`, `player.restore(...)`, `player.retryWithTranscode(slot.value.account)`, `player.fallbackToSoftware(...)`). The session-watch/hls/seekbar/menus/badge/EPG/history/progress all key off `slot`. Presentation computed: `isActive = props.accountId === ws.activeAccount?.id`; `full = isActive && !slot.minimized && slot.status!=='idle'`; `minimizedActive = isActive && slot.minimized`; else hidden. Root: `<div class="iftv-player" :class="{ minimized: minimizedActive, 'iftv-player-hidden': !isActive }">`. **Mute rule:** bind `:muted="!isActive"` on `<video>` (or set `video.muted` in a watcher on isActive) so only the active account has audio. Keep the `<video>` OUTSIDE the full/bar `v-if` chrome blocks (stable node).
- [ ] **Step 3 — hidden styling + back-compat:** `.iftv-player-hidden { position:fixed; width:1px; height:1px; left:-9999px; opacity:0; pointer-events:none; }` (kept in DOM + decoding/connection alive, off-screen, not `display:none` so the video keeps rendering/playing). Update consumers that used the old global player: SettingsView clear-cache disable → `player.anyPlaying` (not just active); any `player.status` reads that meant "is something playing" → `anyPlaying`; Content/GuideView "is this playing" checks → active slot is fine.
- [ ] **Step 4 — gate + commit.** Manual note: multiple concurrent videos verified in Task 4 E2E. `git commit -am "feat(player): PlayerHost renders one PlayerView per playing account; PlayerView is per-slot (accountId prop), active visible+unmuted, others kept mounted+muted+offscreen"`

---

### Task 3: Minimizable bottom bar

**Files:** modify `src/components/PlayerView.vue`, `src/styles/app.css`, `src/App.vue` (shell padding).

- [ ] **Step 1 — minimize/restore controls:** in the full player header, add a **minimize (—)** button (`@click="player.minimize(slot.account)"`) before ✕ Close.
- [ ] **Step 2 — bar chrome:** when `minimizedActive`, render a compact bar: the same `<video>` as a thumbnail + `{{ slot.item?.name }}` (for live, append `epg.nowNextFor(slot.item.name).now?.title`) + a play/pause button (toggles the video ref's `paused`) + restore (⤢ `player.restore(slot.account)`) + close (✕ `player.stop(slot.account)`). Hide the full chrome (`v-if="full"`), show bar chrome (`v-if="minimizedActive"`).
- [ ] **Step 3 — CSS (`app.css`):** `.iftv-player.minimized { inset:auto; left:0; right:0; bottom:0; top:auto; height:56px; width:auto; flex-direction:row; align-items:center; gap:.5rem; background:var(--bs-body-bg); color:var(--bs-body-color); border-top:1px solid var(--bs-border-color); z-index:1055; padding:0 .5rem; }` `.iftv-player.minimized video { width:96px; height:54px; object-fit:cover; border-radius:4px; }` `.iftv-player.minimized .iftv-bar-title { flex:1; min-width:0; }` (truncate). Shell: when a bar is docked, nothing else needs to move (it overlays the bottom); optionally add `padding-bottom:56px` to `.iftv-main` when `player.slots[active]?.minimized`.
- [ ] **Step 4 — gate + commit.** `git commit -am "feat(player): minimizable bottom bar (thumbnail/title/play-pause/restore/close) + minimize button — same <video>, uninterrupted playback"`

---

### Task 4: E2E + final whole-branch review

**Files:** add `dev/e2e-multiaccount.mjs`.

- [ ] **Step 1 — E2E** (real Cockpit; needs ≥2 accounts — the panel account + an M3U/second account exist): play a live channel on account 1 → note its `<video>` advancing → switch to account 2's tab → play a channel → assert **BOTH** `<video>`s have `currentTime` advancing (two connections, one per account) and only one is unmuted → **minimize** the active one → assert the bar renders, its video still advances, and a browse element behind it is clickable → **restore** → switch back to account 1 → still playing. Record in the task report.
- [ ] **Step 2 — final whole-branch review** (dispatch a reviewer): focus the **per-account single-flight** (maxActive-per-account===1 under all interleavings; no cross-account interference; minimize is pure UI; no session leak on account switch / stop / rapid ops) + the muting/visibility correctness. Fix findings; re-gate.
- [ ] **Step 3 — merge to `main`.**

---

## Self-Review
- **Spec coverage:** per-account slots + single-flight (T1), PlayerHost/per-slot render + mute (T2), minimizable bar (T3), E2E + review (T4).
- **Invariant:** each `Slot` has its own `_mx`; every action operates on exactly one slot; per-account maxActive===1 preserved; accounts independent (concurrent). Minimize/restore never touch the session.
- **No regression:** back-compat getters keep existing consumers working; `<video>` nodes stable (keyed by accountId) → uninterrupted playback across minimize/restore/tab-switch; engine/adapters unchanged.
- **Risk:** this is the reviewed connection-leak core — hence the exhaustive per-slot + cross-account tests and a mandatory final review before merge.
