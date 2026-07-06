# In-flight TV — EPG (TV Guide) Design

## Goal
Show programme data for live channels: **now/next** on channel cards + a player strip, a **per-channel schedule**, and a full **channel×time guide grid**. Data comes from a configurable external **XMLTV** URL (the panel itself serves no EPG — verified: `get_short_epg`/`get_simple_data_table` empty, `xmltv.php` 404), matched to the panel's live channels **by normalized name**.

## Background / current state
Vue3/Pinia/Bootstrap Cockpit plugin. Live channels = `ContentItem{kind:'live', name, streamId, epg_channel_id?}` browsed in a `VirtualGrid` of `ContentCard`s (`HomeView` selector: Live/Movies/Series/★ Library). Panel API in `core/xtream/*` (`XtreamTransport.fetchText(url)` exists). Persistence: `JsonStore` (`createCockpitStore`, `settings.json`). Playback via `player` store (one connection at a time). **Verified data source:** `https://epgshare01.online/epgshare01/epg_ripper_TR1.xml.gz` — 178 Turkish channels, ~14,381 programmes, 2.3 MB uncompressed, current. **Panel `epg_channel_id` does NOT match XMLTV ids** (panel: human names like `"TRT SPOR"`, many `"NULL"`; XMLTV: `TRT.1.HD.tr`) → matching is by normalized display-name.

## Non-goals
- No panel EPG (it has none). No per-programme reminders/recording. No EPG editing. No multi-source merge (one URL at a time). Channels not in the feed simply show no EPG (expected — panel has 5036, feed has 178).

## Architecture

### 1. Settings (`stores/settings.ts`)
- `epgUrl: string` — default `https://epgshare01.online/epgshare01/epg_ripper_TR1.xml.gz`; empty = EPG disabled. Persisted; `setEpgUrl(url)` (validate `http(s)` or empty). `EPG_TTL_MS = 12h`.

### 2. Fetch adapter (`adapters/cockpitEpg.ts`)
- `fetchEpgXml(url): Promise<string>` — `cockpit.spawn(['sh','-c','curl -fsSL --max-time 60 "$0" | gunzip -c 2>/dev/null || curl -fsSL --max-time 60 "$0"', url])`. URL as `$0` (injection-safe). Gunzips a `.gz`, else returns raw. Throws on failure (store catches → keeps last cache).

### 3. Core (pure, DI-tested — `core/epg/`)
- `types.ts`: `Programme{ channelId: string; startMs: number; stopMs: number; title: string; desc: string }`, `XmltvChannel{ id: string; names: string[] }`, `ParsedEpg{ channels: XmltvChannel[]; programmes: Programme[] }`, `EpgIndex = Record<string, Programme[]>` (normalizedName → sorted programmes).
- `parseXmltv.ts` `parseXmltv(xml): ParsedEpg` — lightweight string/regex parser (XMLTV is regular, no DOM → node-testable): extract `<channel id="…"><display-name>…` and `<programme start="…" stop="…" channel="…"><title>…</title><desc>…`; decode XML entities (`&amp;`/`&lt;`/`&gt;`/`&quot;`/`&#nn;`); parse `YYYYMMDDHHMMSS ±ZZZZ` → epoch ms honoring the offset. Robust to missing desc/lang attrs.
- `normalize.ts` `normalizeChannelName(name)` — strip leading country/prefix tokens (`TR:`, `TR |`, `[TR]`), quality tags (`HD/SD/FHD/UHD/4K/H265`), punctuation; map Turkish letters (İ/I→i, Ş→s, Ğ→g, Ü→u, Ö→o, Ç→c, ı→i); lowercase; collapse whitespace. Pure, heavily tested (the matching hinges on it).
- `index.ts` `buildIndex(parsed): EpgIndex` — group programmes by channelId, then key each channel's programmes under **every** normalized display-name (sorted by startMs). `nowNext(progs, nowMs) → { now: Programme|null; next: Programme|null }`; `programmesInWindow(progs, fromMs, toMs)`; `daySchedule(progs, nowMs)` (today from now).

### 4. EPG store (`stores/epg.ts`)
Pinia `useEpgStore`: state `{ index: EpgIndex; loadedAt: number; loading: boolean; error: string }`, `$configure({ store, fetchXml })`. `load()` reads cached `epg.json` (`{ loadedAt, programmes }` → rebuild index) — survives reloads without re-fetching. `refresh()` (guards concurrent): `fetchEpgXml(settings.epgUrl)` → `parseXmltv` → `buildIndex` → persist `{loadedAt, programmes}` → set state; on error set `error`, keep old index. `ensureFresh()` on mount: if `epgUrl` set and `now-loadedAt > EPG_TTL_MS` → background `refresh()`. Getters: `nowNextFor(name)`, `scheduleFor(name)`, `hasEpgFor(name)`, `guideChannels(liveItems, fromMs, toMs)` → `[{ item, programmes }]` for matched channels. Best-effort persistence.

### 5. UI
- **`ContentCard`** (live only): a small `iftv-card-epg` line — `● {now.title}` + `· {next.title}` when `epg.nowNextFor(item.name)` matches; nothing otherwise. No layout shift when absent.
- **`PlayerView`** (live only): a now-playing strip — current programme title + a thin progress bar (`(now - startMs)/(stopMs - startMs)`), updated on the existing tick.
- **Per-channel schedule**: an EPG affordance (card ⓘ / player) opens a small panel listing `scheduleFor(name)` (time + title, current highlighted).
- **Guide grid** (`views/guide/GuideView.vue`): reached via a **Guide** button in the `HomeView` selector (live-only accounts too). Layout: left column = channel names (matched live channels), a horizontal **time axis** starting at `now` rounded down to :00/:30, spanning a window (default +6h, scrollable/pannable), programmes as blocks positioned `left=(startMs-windowStart)/msPerPx`, width by duration; a **current-time vertical marker**; click a block → details popover with a **Play** (routes `player.play(account, channelItem)`). Rows virtualized (only visible channel rows rendered) for the ~178 matched set. Empty state when no `epgUrl`/no data.

### 6. Timezone
XMLTV `start`/`stop` include explicit offsets (`+0300`) → parsed to absolute epoch ms; all comparisons in ms; display formatted in the viewer's local time (`toLocaleTimeString`).

## Data flow (now/next on a card)
`epg.load() (cached) → card computes normalizeChannelName(item.name) → index[name] → nowNext(progs, Date.now()) → renders ● now · next`. Background `ensureFresh()` refetches if >12h old.

## Error handling
- Fetch/parse failure → `epg.error` set, last cache kept; UI shows no-EPG gracefully (no crash). Settings surfaces the error + last-updated time.
- Empty/invalid `epgUrl` → EPG disabled (no line, grid shows "Set an EPG URL in Settings").
- Unmatched channel → no EPG line/row (silent, expected).
- Malformed XMLTV entries skipped, not fatal.
- Missing `epg.json` on first load → empty index until first `refresh()`.

## Testing
- **Pure (unit):** `parseXmltv` (channels/programmes, entities, `±ZZZZ` timestamp→ms, missing desc); `normalizeChannelName` (TR: prefix, HD/SD tags, Turkish letters, punctuation — table of real panel↔feed pairs incl. `"TR: TRT SPOR HD"`↔`"TRT SPOR HD"`→`trt spor`); `buildIndex`/`nowNext`/`programmesInWindow`/`daySchedule` (boundaries: before-first, between, after-last).
- **Store:** `load` from cached epg.json rebuilds the index; `refresh` fetches→parses→persists (injected `fetchXml`); error keeps old index; `ensureFresh` refreshes only when stale; getters match by normalized name.
- **E2E (real Cockpit, `dev/e2e-*.mjs`):** with the default URL, open live → assert at least one card shows a now/next line (a known TR channel, e.g. matched TRT/ATV/Show); open the Guide → assert channel rows + programme blocks render + the current-time marker; a block's Play starts that channel. Record in the task report. (Uses the external epgshare URL — not a panel connection.)
- Full `npm test && typecheck && build && test:smoke` per task.

## Rollout (subagent-driven-development)
1. **Core:** `core/epg/{types,parseXmltv,normalize,index}.ts` (pure ops + helpers, exhaustive tests).
2. **Fetch + store + setting:** `adapters/cockpitEpg.ts`; `stores/epg.ts` (cache/TTL/refresh/getters + tests); `settings.ts` `epgUrl` + `App.vue` `epg.load()`+`ensureFresh()` on mount; Settings "TV Guide (EPG)" section (URL + refresh + last-updated + error).
3. **Now/next + schedule:** `ContentCard` live now/next line; `PlayerView` live now-playing strip; per-channel schedule popover.
4. **Guide grid:** `views/guide/GuideView.vue` (time axis, positioned programme blocks, current-time marker, row virtualization, click→details→Play) + **Guide** selector button in `HomeView`; E2E.
