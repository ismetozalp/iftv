# Per-account EPG (design spec)

**Date:** 2026-07-07
**Status:** approved (user chose "Full")

## Goal

Give **each account its own TV guide** instead of one global XMLTV matched by name across
everything. Resolve each account's EPG from (in priority order) a manual per-account URL, the
provider's own guide (Xtream `xmltv.php` / M3U `url-tvg`), then the global URL as a fallback;
index and match **per account**, preferring the channel's **EPG id** (Xtream `epg_channel_id` /
M3U `tvg-id`) over the fuzzy normalized name.

Fixes today's inconsistency: the Add-account form already has an "EPG URL" field and `Account.epgUrl`
is persisted, but **nothing reads it** — `refresh()` only ever fetches the global `settings.epgUrl`.

## Current state (what changes)

- `settings.epgUrl` — one global XMLTV (default `…epg_ripper_TR1.xml.gz`).
- `epg` store holds ONE `index` keyed by **normalized name**; `refresh()` fetches only the global URL.
- Cards/guide/player look up `epg.nowNextFor(name)` — name-only, no account context, no id.
- `ContentItem` has **no `epgId`**; the Xtream parser drops `epg_channel_id`, the M3U parser drops
  `tvg-id` and the header `url-tvg`.
- `Account.epgUrl` exists + is editable in `AccountForm` but is **dead**.

## Design

### 1. Carry the EPG id on content
- `ContentItem` gains `epgId: string` (`''` when unknown).
- `getLiveStreams` (Xtream): `epgId: toStr(r.epg_channel_id)`.
- `parseM3u`: `epgId: attr(line, 'tvg-id')`.
- All other `ContentItem` producers (VOD/series) set `epgId: ''` (id only matters for live).

### 2. Capture the M3U's own guide URL
- `parseM3u` returns `{ categories, items, tvgUrl }` where `tvgUrl` = `url-tvg` (or `x-tvg-url`)
  from the `#EXTM3U` header (`''` if absent). The M3U provider exposes it via a new
  `getTvgUrl(): Promise<string>` on `ContentProvider` (Xtream returns `''`).

### 3. Per-account EPG URL resolution — `core/epg/source.ts` (pure, unit-tested)
`resolveEpgUrl(account, globalUrl, tvgUrl): string`
1. `account.epgUrl?.trim()` → use it (manual override wins).
2. else `account.type === 'xtream'` → `‹base›/xmltv.php?username=‹u›&password=‹p›` (built from the
   account URL via `parseXtreamUrl`, scheme+host+port preserved).
3. else `account.type === 'm3u'` and `tvgUrl` → `tvgUrl` (the playlist's declared guide).
4. else `globalUrl` (the Settings fallback) — may be `''` (⇒ no EPG for that account).

### 4. Id-or-name index — `core/epg/index.ts`
- `EpgIndex` becomes `{ byId: Record<string, Programme[]>; byName: Record<string, Programme[]> }`.
- `buildIndex` fills `byId[channel.id]` and `byName[normalizeChannelName(name)]` for each channel name.
- `lookup(index, name, epgId): Programme[]` = `(epgId && index.byId[epgId]) || index.byName[normalizeChannelName(name)] || []`.
  Id match is exact and wins; name is the fallback. (`nowNext`/`programmesInWindow` unchanged.)

### 5. Per-account EPG store — `stores/epg.ts`
State becomes per-account:
- `byAccount: Record<accountId, { index: EpgIndex; loadedAt: number; error: string }>`
- `tvgUrlByAccount: Record<accountId, string>` — the M3U `url-tvg` captured when the library store
  parses that account's content (via `epg.noteTvgUrl(accountId, url)`).
- `loading: Set<accountId>` (or a per-account flag), `nowMs` clock (unchanged).

Actions:
- `load()` — rebuild every account's index from the on-disk cache (`epg.json` becomes
  `{ [accountId]: { loadedAt, channels, programmes } }`). Never fetches.
- `refresh(account)` — `url = resolveEpgUrl(account, settings.epgUrl, tvgUrlByAccount[id])`; if `url`
  is empty, clear that account's index; else fetch+parse+index into `byAccount[id]`, persist. Never throws.
- `ensureFresh(account)` — refresh that account if its `loadedAt` is older than `EPG_TTL_MS`.
- `noteTvgUrl(accountId, url)` — record the M3U guide URL (may trigger a refresh if it changes the resolved URL).

Getters take an accountId (default = `useWorkspaceStore().activeAccount?.id`):
- `nowNextFor(name, epgId, accountId?)`, `scheduleFor(name, epgId, accountId?)`,
  `hasEpgFor(name, epgId, accountId?)`, and the guide's `rowsFor(items, from, to, accountId?)`.

### 6. Consumers pass account context
- `ContentCard.vue` — cards render for the active account's browse → look up with
  `epg.nowNextFor(item.name, item.epgId, ws.activeAccount?.id)`.
- `GuideView.vue` — build rows from the **active account's** index (`ws.activeAccount?.id`), matching
  each channel by `item.epgId` then name.
- `PlayerView.vue` — the live now/next strip uses `slot.account.id` + the playing item's `name`/`epgId`.

### 7. Loading triggers
- `App.vue onMounted`: `epg.load()`, then for each **open** account `epg.ensureFresh(account)`.
- Workspace: when an account is opened / becomes active, `epg.ensureFresh(account)`.
- The M3U provider path calls `epg.noteTvgUrl(accountId, tvgUrl)` after parsing (so `url-tvg` derive works).

### 8. Settings + AccountForm copy
- Settings: relabel the field **"Default EPG URL (XMLTV) — fallback for accounts without their own"**.
  Same `settings.epgUrl`, same validation.
- `AccountForm`: keep the per-account "EPG URL" field; add help text: *"Leave blank to auto-detect
  (Xtream panel guide / playlist `url-tvg`), or fall back to the default in Settings."*

### 9. Data: seed JetIPTV
Set the **JetIPTV** account's `epgUrl` to the current global URL
(`https://epgshare01.online/epgshare01/epg_ripper_TR1.xml.gz`) in `~/.config/cockpit/inflighttv/accounts.json`
so it keeps its exact guide after the switch to per-account. (Data change, done once at the end.)

## Persistence / migration
- `epg.json` shape changes from `{loadedAt,channels,programmes}` to keyed-by-accountId. On load, an old
  (unkeyed) cache is ignored (treated as empty) — it repopulates on the next refresh; no user-visible loss
  beyond a one-time re-fetch.

## Error handling
- A per-account fetch failure sets only that account's `error` and leaves other accounts intact.
- Empty resolved URL ⇒ that account simply has no guide (cards show no now/next; guide shows "No guide data").
- Xtream `xmltv.php` that 404s / returns non-XML ⇒ caught, error stored, cards fall back to nothing (or the
  global fallback only if that was the resolved URL — no silent cross-account bleed).

## Testing
- `core/epg/source.ts`: unit tests for `resolveEpgUrl` (manual > xtream xmltv.php > m3u tvgUrl > global > '').
- `core/epg/index.ts`: `buildIndex` byId+byName; `lookup` id-wins-then-name.
- `parseM3u`: captures `tvg-id` per item + header `url-tvg`.
- `getLiveStreams`: captures `epg_channel_id` → `epgId`.
- `stores/epg.ts`: per-account refresh (fake fetch) isolates accounts; TTL; noteTvgUrl re-resolves; load
  from keyed cache; empty-URL clears.
- E2E smoke: JetIPTV shows now/next (its seeded URL), a second account with its own/derived URL shows its
  own guide, and the two don't cross-contaminate.

## Out of scope (v1)
Merging multiple EPG sources per account; background refresh scheduling beyond TTL-on-open; DVR/catch-up;
per-channel manual EPG mapping UI; Xtream `get_short_epg` API (we use the panel's `xmltv.php` dump).
