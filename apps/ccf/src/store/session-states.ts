/**
 * MULTI-SESSION VIEW STATE — the reactive face of the per-runtime session
 * cache (`sessionStateByRuntimeIdRef` in use-session-state-cache).
 *
 * The cache already ingests EVERY session's gateway events; only the view
 * was single-session ($messages + the active-id gate). This store mirrors
 * the cache per runtime id so any number of surfaces (session tiles, future
 * pane windows) can each subscribe to one session's state without touching
 * the main chat's `$messages` pipeline — same pattern as `useSessionSlice`
 * over `$todosBySession`, applied to whole `ClientSessionState`s.
 *
 * TILES are the first consumer: sessions opened side-by-side with the main
 * thread, each in its own layout-tree pane. `$sessionTiles` holds the
 * stored-session ids (persisted — tiles survive restarts); the wiring layer
 * owns resume/submit (it has the gateway + cache internals) and registers
 * itself here as the delegate so tile UI stays dependency-light.
 */

import { atom, computed } from 'nanostores'

import type { ClientSessionState } from '@/app/types'
import { findGroup, findGroupOfPane } from '@/components/pane-shell/tree/model'
import { $activeTreeGroup, $layoutTree, noteActiveTreeGroup, revealTreePane } from '@/components/pane-shell/tree/store'
import { readJson, writeJson } from '@/lib/storage'

import { $activeGatewayProfile, normalizeProfileKey } from './profile'
import { $activeSessionId, $selectedStoredSessionId } from './session'
import { isSecondaryWindow } from './windows'

// ---------------------------------------------------------------------------
// Reactive per-runtime session state (view mirror of the wiring cache).
// ---------------------------------------------------------------------------

export const $sessionStates = atom<Record<string, ClientSessionState>>({})

/** Publish one session's state (immutable per-key — slices stay stable). */
export function publishSessionState(runtimeId: string, state: ClientSessionState) {
  $sessionStates.set({ ...$sessionStates.get(), [runtimeId]: state })
}

export function dropSessionState(runtimeId: string) {
  const current = $sessionStates.get()

  if (!(runtimeId in current)) {
    return
  }

  const { [runtimeId]: _dropped, ...rest } = current
  $sessionStates.set(rest)
}

// ---------------------------------------------------------------------------
// Session tiles.
// ---------------------------------------------------------------------------

/** Edge a tile docks against main when it first joins the tree. Shared by
 *  session tiles and route (page) tiles. */
export type SplitDir = 'bottom' | 'left' | 'right' | 'top'

/** Where a tile lands on adoption: an edge split, or `center` = stack into
 *  the anchor's zone as a tab (a drop on the zone's tab strip). */
export type TileDock = 'center' | SplitDir

export interface SessionTile {
  /** Stored session id — the durable identity (runtime ids are ephemeral). */
  storedSessionId: string
  /** Dock against `anchor` on adoption (default right; center = stack). */
  dir?: TileDock
  /** Pane to dock against (a drop's target zone) — default the workspace.
   *  In-memory only: after first adoption the tree remembers placement. */
  anchor?: string
  /** Center docks: stack BEFORE this pane id (`null`/omitted = append) —
   *  the strip divider's slot. In-memory, like `anchor`. */
  before?: null | string
  /** Live runtime id once the tile's resume has bound one. */
  runtimeId?: string
  /** Resume failed terminally (shown in the tile; retryable). */
  error?: string
}

// Tiles are persisted PER PROFILE: a session belongs to one profile, and the
// single live gateway is scoped to one profile at a time, so a tile only makes
// sense while its profile is active. Switching profiles swaps the visible set
// (and drops runtime bindings so each tile re-resumes against the now-current
// gateway — which also settles the "tile resumes against the wrong backend" and
// "stale runtime after respawn" bugs by construction).
const TILES_KEY = 'hermes.desktop.sessionTiles.v2'
const LEGACY_TILES_KEY = 'hermes.desktop.sessionTiles.v1'

type StoredTile = Pick<SessionTile, 'dir' | 'storedSessionId'>

const toStored = (t: SessionTile): StoredTile => ({ dir: t.dir, storedSessionId: t.storedSessionId })

function parseTileList(value: unknown): StoredTile[] {
  return Array.isArray(value)
    ? value
        .filter((t): t is SessionTile => Boolean(t && typeof (t as SessionTile).storedSessionId === 'string'))
        .map(toStored)
    : []
}

function loadTilesByProfile(): Record<string, StoredTile[]> {
  const byProfile: Record<string, StoredTile[]> = {}
  const parsed = readJson<unknown>(TILES_KEY)

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [profile, list] of Object.entries(parsed as Record<string, unknown>)) {
      const tiles = parseTileList(list)

      if (tiles.length > 0) {
        byProfile[normalizeProfileKey(profile)] = tiles
      }
    }
  }

  // Migrate a v1 flat list into the default profile, then retire the key.
  const legacy = parseTileList(readJson<unknown>(LEGACY_TILES_KEY))

  if (legacy.length > 0) {
    const key = normalizeProfileKey('default')
    byProfile[key] = [...(byProfile[key] ?? []), ...legacy]
  }

  writeJson(LEGACY_TILES_KEY, null)

  return byProfile
}

const tilesByProfile = loadTilesByProfile()
// Keyed by the GATEWAY profile: the rail's profile switch is a soft swap
// ($activeGatewayProfile moves, no reload) — $activeProfile mirrors the
// window's primary backend and never changes on a rail switch, so keying on
// it left the previous profile's tiles registered (phantom "Session" tabs).
const profileKey = () => normalizeProfileKey($activeGatewayProfile.get())

// Session tiling (splitting a second chat into its own pane beside the main
// one) is disabled for CCF — never starts populated from persisted storage,
// regardless of what an earlier build or test session left behind there. Old
// persisted tiles restoring themselves on launch (bypassing openSessionTile
// entirely, since this is a direct atom initializer) was exactly what kept
// bringing the tab-strip header back after it looked "fixed" — this and the
// no-op in openSessionTile below are the two places tiles could ever appear
// from, so both are permanently closed instead of only removing the visible
// trigger.
export const $sessionTiles = atom<SessionTile[]>([])

function persistTiles() {
  // Shares the origin's storage; a secondary window holds no tiles, so a write
  // back would only wipe the primary's set.
  if (isSecondaryWindow()) {
    return
  }

  writeJson(TILES_KEY, Object.keys(tilesByProfile).length === 0 ? null : tilesByProfile)
}

function saveTiles(tiles: SessionTile[]) {
  $sessionTiles.set(tiles)
  const stored = tiles.map(toStored)

  if (stored.length > 0) {
    tilesByProfile[profileKey()] = stored
  } else {
    delete tilesByProfile[profileKey()]
  }

  persistTiles()
}

// Session tiling disabled — $sessionTiles is permanently empty (see above),
// so there is nothing for a profile switch to repopulate here anymore.

export function patchSessionTile(storedSessionId: string, patch: Partial<SessionTile>) {
  saveTiles($sessionTiles.get().map(t => (t.storedSessionId === storedSessionId ? { ...t, ...patch } : t)))
}

/** Drop live runtime bindings so every tile re-resumes — used on gateway
 *  reconnect, where a respawned backend re-mints (recycles) runtime ids. */
export function resetTileRuntimeBindings() {
  const tiles = $sessionTiles.get()

  if (tiles.some(t => t.runtimeId)) {
    $sessionTiles.set(tiles.map(toStored))
  }
}

// ---------------------------------------------------------------------------
// Delegate — the wiring layer (which owns the gateway + session cache) plugs
// its actions in; tile UI calls through here. Same inversion as the tree
// store's pane closers.
// ---------------------------------------------------------------------------

export interface SessionTileDelegate {
  /** Archive a stored session (the sidebar's archive, incl. tile cleanup). */
  archiveSession(storedSessionId: string): Promise<void>
  /** Branch a stored session into a new chat (the sidebar's branch). */
  branchSession(storedSessionId: string): Promise<void>
  /** Delete a stored session (the sidebar's delete, incl. tile cleanup). */
  deleteSession(storedSessionId: string): Promise<void>
  /** Run a slash command against a tile's session (app-level effects — e.g.
   *  branch/handoff — act on the main surface, as they should). */
  executeSlash(rawCommand: string, sessionId: string): Promise<void>
  /** Interrupt a tile's running turn. */
  interruptSession(runtimeId: string): Promise<void>
  /** Bind a live runtime id for a stored session (resume without touching
   *  the main view). Returns the runtime id, or throws. */
  resumeTile(storedSessionId: string): Promise<string>
  /** Submit a prompt to a tile's live session. */
  submitToSession(runtimeId: string, text: string): Promise<void>
  /** THE session-state write path — routes through the wiring cache so the
   *  cache, the primary view (when active), and every tile mirror agree. */
  updateSession(runtimeId: string, updater: (state: ClientSessionState) => ClientSessionState): ClientSessionState
}

let delegate: SessionTileDelegate | null = null

export function setSessionTileDelegate(next: SessionTileDelegate) {
  delegate = next
}

export function sessionTileDelegate(): SessionTileDelegate | null {
  return delegate
}

/** Session tiling is disabled for CCF — this is the single chokepoint every
 *  entry point funnels through (drag-to-split in session-drag.ts, the
 *  sidebar's "..." menu, ⌘⇧T's reopenLastClosedTile, use-session-actions),
 *  so a no-op here closes all of them at once rather than patching each
 *  trigger site individually. $sessionTiles above is the other half — always
 *  empty, never hydrated from persisted storage — so a tile from a much
 *  earlier build can't silently reappear on launch either. Kept as a
 *  same-signature no-op instead of deleting the callers so this stays cheap
 *  to re-enable later if split-view chat ever becomes a real feature. */
export function openSessionTile(
  _storedSessionId: string,
  _dir: TileDock = 'right',
  _anchor?: string,
  _before?: null | string
) {
  return
}

/** If a session is already ON SCREEN — an open tile OR the one loaded in main —
 *  front its tab (and focus its zone) and return true. A sidebar click on an
 *  already-open chat JUMPS to its tab instead of reloading it; `false` means the
 *  caller must load it into main. Covers the two dead clicks: an open tile, and
 *  the main session while focus sits on a tile (route unchanged → no reload). */
export function focusOpenSession(storedSessionId: string): boolean {
  if ($sessionTiles.get().some(t => t.storedSessionId === storedSessionId)) {
    const paneId = `${TILE_PANE_PREFIX}${storedSessionId}`
    revealTreePane(paneId) // un-dismiss + adopt + front in its group
    const tree = $layoutTree.get()
    const group = tree ? findGroupOfPane(tree, paneId) : null

    if (group) {
      noteActiveTreeGroup(group.id)
    }

    return true
  }

  // Already the main session: front the workspace tab and drop tile focus so
  // the readouts + sidebar highlight come home (a no-op when main is focused).
  if (storedSessionId === $selectedStoredSessionId.get()) {
    revealTreePane('workspace')
    noteActiveTreeGroup(null)

    return true
  }

  return false
}

// Closed-tab stack for ⌘⇧T reopen (in-memory) — keyed PER PROFILE like the
// tiles themselves, so ⌘⇧T after a profile switch never resurrects the other
// profile's session. The tile's placement is remembered so it returns in place.
const closedTilesByProfile: Record<string, SessionTile[]> = {}
const closedStack = (): SessionTile[] => (closedTilesByProfile[profileKey()] ??= [])

export function closeSessionTile(storedSessionId: string) {
  const tile = $sessionTiles.get().find(t => t.storedSessionId === storedSessionId)

  if (tile) {
    closedStack().push({ anchor: tile.anchor, before: tile.before, dir: tile.dir, storedSessionId })
  }

  saveTiles($sessionTiles.get().filter(t => t.storedSessionId !== storedSessionId))
}

/** Drop a DEAD tile — a persisted tile whose session no longer exists on the
 *  backend (resume 404s). Unlike close, it leaves no ⌘⇧T undo (resurrecting it
 *  would just 404 again) and evicts any cached state. This is what clears the
 *  "Session not found" resume spam from stale/cross-profile persisted tiles. */
export function discardSessionTile(storedSessionId: string) {
  const runtimeId = $sessionTiles.get().find(t => t.storedSessionId === storedSessionId)?.runtimeId

  if (runtimeId) {
    dropSessionState(runtimeId)
  }

  saveTiles($sessionTiles.get().filter(t => t.storedSessionId !== storedSessionId))
}

/** ⌘⇧T — reopen the most recently closed tab where it was. Skips ids that are
 *  live again (reopened, or now the primary). */
export function reopenLastClosedTile(): void {
  const stack = closedStack()

  for (let tile = stack.pop(); tile; tile = stack.pop()) {
    const { storedSessionId } = tile

    if (storedSessionId === $selectedStoredSessionId.get()) {
      continue
    }

    if (!$sessionTiles.get().some(t => t.storedSessionId === storedSessionId)) {
      openSessionTile(storedSessionId, tile.dir, tile.anchor, tile.before)

      return
    }
  }
}

// ---------------------------------------------------------------------------
// The FOCUSED session — one derivation, not another hand-maintained
// "$activeSession" sibling. The layout's interaction tracker ($activeTreeGroup:
// last click/focus, the same source ⌘W uses) resolves to a zone; its active
// pane names the session: a `session-tile:<storedId>` pane IS that session,
// anything else falls back to the route-driven primary. Chrome that should
// follow the user between tiles (titlebar session title, statusbar context /
// timer / model) reads these instead of the primary-only atoms.
// ---------------------------------------------------------------------------

const TILE_PANE_PREFIX = 'session-tile:'

/** Stored id of the focused session (the interacted zone's tile, else the
 *  primary's selection). Null on a fresh draft. */
export const $focusedStoredSessionId = computed(
  [$activeTreeGroup, $layoutTree, $selectedStoredSessionId],
  (groupId, tree, selected) => {
    const active = groupId && tree ? findGroup(tree, groupId)?.active : undefined

    return active?.startsWith(TILE_PANE_PREFIX) ? active.slice(TILE_PANE_PREFIX.length) : selected
  }
)

/** Live runtime id of the focused session (a tile's bound runtime, else the
 *  primary's active session). */
export const $focusedRuntimeId = computed(
  [$focusedStoredSessionId, $selectedStoredSessionId, $activeSessionId, $sessionTiles],
  (focused, selected, primaryRuntime, tiles) => {
    if (focused && focused !== selected) {
      return tiles.find(t => t.storedSessionId === focused)?.runtimeId ?? null
    }

    return primaryRuntime
  }
)

/** The focused session's state slice (undefined while unresolved/unbound). */
export const $focusedSessionState = computed([$focusedRuntimeId, $sessionStates], (runtimeId, states) =>
  runtimeId ? states[runtimeId] : undefined
)

// A PRIMARY navigation (sidebar resume, route change, new chat) moves focus
// home to the workspace — a previously-clicked tile must not keep owning the
// titlebar/statusbar readouts for a session switch it had no part in. It also
// FRONTS the workspace tab: the resumed chat loads in the workspace pane, so a
// zone parked on a tile tab must switch back or the click looks dead.
$selectedStoredSessionId.listen(() => {
  noteActiveTreeGroup(null)
  revealTreePane('workspace')
})

// Dev hook for automation (mirrors __HERMES_LAYOUT_TREE__).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__HERMES_SESSION_TILES__ = {
    close: closeSessionTile,
    open: openSessionTile,
    patch: patchSessionTile,
    publish: publishSessionState,
    states: () => $sessionStates.get(),
    tiles: () => $sessionTiles.get()
  }
}
