import { useStore } from '@nanostores/react'
import { computed } from 'nanostores'
import type { CSSProperties, ReactElement, PointerEvent as ReactPointerEvent } from 'react'

import { PREVIEW_RAIL_MAX_WIDTH, PREVIEW_RAIL_MIN_WIDTH } from '@/app/chat/right-rail'
import { PALETTE_AREA, type PaletteContribution } from '@/app/command-palette/contrib'
import { CcfSidebarResizeHandle, useCcfSidebarWidth } from '@/app/shell/ccf-sidebar-resize'
import { SessionTitleLabel } from '@/app/shell/session-title-label'
import { type StatusbarItem } from '@/app/shell/statusbar-controls'
import { TranscriptAppearanceEffect } from '@/app/shell/transcript-appearance-effect'
import { group, split } from '@/components/pane-shell/tree/model'
import { LayoutTreeRoot } from '@/components/pane-shell/tree/renderer'
import type { DoubleTapContext } from '@/components/pane-shell/tree/renderer/drag-session'
import {
  bindTreeSideVisibility,
  declareDefaultTree,
  dismissTreePane,
  dockPaneBeside,
  markCollapsePane,
  paneRootSide,
  registerLayoutResetHandler,
  registerPaneCloser,
  registerPaneOpener,
  resetLayoutTree,
  revealTreePane,
  setPaneCollapsed,
  setTreePaneHidden,
  watchContributedPanes
} from '@/components/pane-shell/tree/store'
import { SidebarProvider } from '@/components/ui/sidebar'
import { discoverBundledPlugins } from '@/contrib/plugins'
import { Slot } from '@/contrib/react/slot'
import { registry } from '@/contrib/registry'
import { discoverRuntimePlugins } from '@/contrib/runtime-loader'
import { sessionTitle as storedSessionTitle } from '@/lib/chat-runtime'
import { Brain, Clock, Command, LayoutDashboard, Terminal } from '@/lib/icons'
import { Codecs, persistentAtom } from '@/lib/persisted'
import {
  $fileBrowserOpen,
  $panesFlipped,
  $sidebarOpen,
  FILE_BROWSER_DEFAULT_WIDTH,
  FILE_BROWSER_MAX_WIDTH,
  FILE_BROWSER_MIN_WIDTH,
  setFileBrowserOpen,
  setSidebarOpen
} from '@/store/layout'
import { $filePreviewTarget, $previewTarget, closeRightRail } from '@/store/preview'
import { $reviewOpen, closeReview, REVIEW_PANE_ID } from '@/store/review'
import { $currentCwd, $selectedStoredSessionId, $sessions, sessionMatchesStoredId } from '@/store/session'

import type { SessionDragPayload } from '../chat/composer/inline-refs'
import { watchRouteTiles } from '../chat/route-tile'
import { startSessionDrag } from '../chat/session-drag'
import {
  SessionTileCloseConfirm,
  stackSessionTilesIntoMain,
  watchSessionTiles,
  WorkspaceTabMenu
} from '../chat/session-tile'
import { $terminalTakeover, setTerminalTakeover } from '../right-sidebar/store'
import { AGENTS_ROUTE, COMMAND_CENTER_ROUTE, CRON_ROUTE } from '../routes'
import { $workspaceIsPage } from '../routes'

import { FilesPane, LogsPane, PreviewRailPane, ReviewPaneContent } from './panes'
import { ContribWiring, WiredPane } from './wiring'

/**
 * Stripped-down app root (bb/contrib-areas) on the layout TREE model, mounting
 * the REAL app surfaces. The title bar and status bar sit OUTSIDE the grid
 * (fixed chrome) but are fully composable: title bar renders `titleBar.left/
 * right` slots; the status bar consumes `statusBar.left/right` DATA
 * contributions (payload = StatusbarItem). Core registers its items through
 * the same calls a plugin would use.
 */

// ---------------------------------------------------------------------------
// Pane contributions. `data.placement` = semantic role for grid presets;
// `data.minWidth/maxWidth/minHeight/maxHeight` = the SAME clamps the app's
// `Pane` props declare — the layout tree sizes zones by weight (percentage)
// but a zone never shrinks/grows past its active pane's clamp.
// Headers are contextual (tree-side): a pane alone in a zone shows no
// header/tab by default; stacked panes show chips. Double-click a zone
// toggles its header either way.
// ---------------------------------------------------------------------------

// ONE render identity for the workspace pane — syncWorkspaceTitle re-registers
// the contribution (new title) and a fresh closure would remount the chat.
const renderWorkspacePane = () => <WiredPane part="chatRoutes" />
// The main tab carries the same session context menu as tile tabs (targets
// the loaded primary session; no menu on a fresh draft).
const wrapWorkspaceTab = (tab: ReactElement) => <WorkspaceTabMenu>{tab}</WorkspaceTabMenu>

/** The `@session` payload for the workspace tab — the loaded primary session,
 *  or null on a fresh draft / full-page view (nothing to link). */
const workspaceDragPayload = (): SessionDragPayload | null => {
  const selected = $selectedStoredSessionId.get()

  if (!selected || $workspaceIsPage.get()) {
    return null
  }

  const stored = $sessions.get().find(s => sessionMatchesStoredId(s, selected))

  return { id: selected, profile: stored?.profile ?? '', title: stored ? storedSessionTitle(stored) : '' }
}

// The main tab drags like a session tile — drop it on a composer to link the
// chat, on a zone/edge to stack/split. Defers (`false`) to the generic pane
// move when there's no loaded session to carry.
const workspaceTabDrag = (event: ReactPointerEvent<HTMLElement>, onTap: () => void, double?: DoubleTapContext) => {
  const payload = workspaceDragPayload()

  if (!payload) {
    return false
  }

  startSessionDrag(payload, event, { double, onTap })

  return true
}

registry.registerMany([
  {
    id: 'workspace',
    area: 'panes',
    // Live-retitled to the loaded session by syncWorkspaceTitle below.
    title: 'New session',
    data: {
      placement: 'main',
      minWidth: '22vw',
      tabDrag: workspaceTabDrag,
      tabWrap: wrapWorkspaceTab,
      uncloseable: true
    },
    render: renderWorkspacePane
  },
  {
    id: 'terminal',
    area: 'panes',
    title: 'terminal',
    // revealOnPreset: choosing a layout that places the terminal (e.g.
    // "Terminal deck") turns takeover on so the zone actually shows, instead of
    // staying collapsed behind the ⌃` toggle. height sizes the fixed track (a
    // single-pane zone declaring a height is a fixed track — the preset weight
    // is moot): a short deck, not a third of the window.
    data: { placement: 'bottom', height: '20vh', minHeight: '7.5rem', maxHeight: '80vh', revealOnPreset: true },
    render: () => <WiredPane part="terminal" />
  },
  {
    id: 'files',
    area: 'panes',
    title: 'files',
    // dock: re-adoption target after a stale dismissal (see sessions).
    data: {
      placement: 'right',
      collapsible: true,
      dock: { pane: 'workspace', pos: 'right' },
      revealAliases: ['file-browser'],
      width: FILE_BROWSER_DEFAULT_WIDTH,
      minWidth: FILE_BROWSER_MIN_WIDTH,
      maxWidth: FILE_BROWSER_MAX_WIDTH
    },
    render: () => <FilesPane />
  },
  {
    id: 'preview',
    area: 'panes',
    title: 'preview',
    // The rail brings its OWN tab strip (per-target tabs with close buttons).
    // Exists only while something is previewed — visibility is bound to the
    // preview targets below, like every other self-managed surface. dock:
    // adoption seed only — dockPaneBeside re-docks it next to files on every
    // reveal anyway (position-aware).
    data: {
      placement: 'right',
      dock: { pane: 'files', pos: 'left' },
      width: 'clamp(18rem, 36vw, 32rem)',
      minWidth: PREVIEW_RAIL_MIN_WIDTH,
      maxWidth: PREVIEW_RAIL_MAX_WIDTH
    },
    render: () => <PreviewRailPane />
  },
  {
    id: 'review',
    area: 'panes',
    title: 'review',
    // The second right sidebar: hidden until ⌘G ($reviewOpen) — bound below
    // like the other chrome toggles; its zone collapses while hidden.
    data: {
      placement: 'right',
      collapsible: true,
      revealAliases: [REVIEW_PANE_ID],
      width: FILE_BROWSER_DEFAULT_WIDTH,
      minWidth: FILE_BROWSER_MIN_WIDTH,
      maxWidth: FILE_BROWSER_MAX_WIDTH
    },
    render: () => <ReviewPaneContent />
  },
  {
    // Optional chrome — in NO default layout. Adoption stacks it with the
    // terminal; $logsOpen (default off, ⌘K "Toggle logs") reveals it.
    id: 'logs',
    area: 'panes',
    title: 'logs',
    // revealOnPreset: the Quad layout places logs, so applying it turns the
    // logs pane on (like a ⌘K "Toggle logs") instead of leaving it collapsed.
    data: { placement: 'bottom', height: '20vh', minHeight: '7.5rem', maxHeight: '80vh', revealOnPreset: true },
    render: () => <LogsPane />
  }
])

// ---------------------------------------------------------------------------
// Chrome contributions. The title bar and status bar are fixed chrome outside
// the grid, composable through these areas. Everything real lives in the real
// components (TitlebarControls / useStatusbarItems). Sample PLUGIN
// contributions don't live here — they're their own files under `src/plugins/`,
// auto-discovered by discoverBundledPlugins() below.
// ---------------------------------------------------------------------------

registry.registerMany([
  // Titlebar center stays empty on purpose: session title lives in tabs +
  // sidebar; place/cwd lives in the sidebar project tree. Center is drag
  // chrome (plugins can still contribute to titleBar.center if needed).
  //
  // Layout edit mode (drag-rearrange panes) is removed for CCF — it's a
  // dev/power-user capability, not something the target (beginner) audience
  // needs, and dropping it is what unblocks giving the sidebar its own
  // bespoke chrome later instead of treating it as just another
  // interchangeable pane-tree zone. toggleLayoutEditMode/ZoneEditor stay in
  // the codebase (upstream feature, untouched) — just no longer reachable
  // from CCF's titlebar, keybinds, or ⌘K.
  //
  // The agent's write -> see loop: rescan <hermes home>/desktop-plugins
  // without relaunching (same-id reloads dispose the previous incarnation).
  {
    id: 'plugins.reload',
    area: PALETTE_AREA,
    data: {
      id: 'plugins.reload',
      label: 'Reload desktop plugins',
      keywords: ['plugins', 'reload', 'refresh', 'desktop'],
      run: () => void discoverRuntimePlugins()
    } satisfies PaletteContribution
  },
  {
    id: 'layout.reset',
    area: PALETTE_AREA,
    data: {
      id: 'layout.reset',
      label: 'Reset layout',
      icon: LayoutDashboard,
      keywords: ['layout', 'reset', 'default', 'panes'],
      run: resetLayoutTree
    } satisfies PaletteContribution
  },
  // The keybind panel's non-titlebar door (the keyboard icon is gone).
  {
    id: 'keybinds.panel',
    area: PALETTE_AREA,
    data: {
      id: 'keybinds.panel',
      label: 'Keyboard shortcuts',
      keywords: ['keybinds', 'shortcuts', 'hotkeys', 'keyboard'],
      run: () => window.dispatchEvent(new CustomEvent('hermes:open-keybinds'))
    } satisfies PaletteContribution
  },
  // Non-statusbar doors for Command Center / Agents / Cron / Terminal — the
  // statusbar no longer shows these (trimmed to just gateway + approval mode
  // for a simpler default chrome), so ⌘K is now how they're reached.
  {
    id: 'commandCenter.open',
    area: PALETTE_AREA,
    data: {
      id: 'commandCenter.open',
      label: 'Command Center',
      icon: Command,
      keywords: ['command', 'center', 'system', 'logs', 'status'],
      run: () => {
        window.location.hash = COMMAND_CENTER_ROUTE
      }
    } satisfies PaletteContribution
  },
  {
    id: 'agents.open',
    area: PALETTE_AREA,
    data: {
      id: 'agents.open',
      label: 'Agents',
      icon: Brain,
      keywords: ['agents', 'subagents', 'sessions'],
      run: () => {
        window.location.hash = AGENTS_ROUTE
      }
    } satisfies PaletteContribution
  },
  {
    id: 'cron.open',
    area: PALETTE_AREA,
    data: {
      id: 'cron.open',
      label: 'Cron',
      icon: Clock,
      keywords: ['cron', 'scheduled', 'jobs', 'automation'],
      run: () => {
        window.location.hash = CRON_ROUTE
      }
    } satisfies PaletteContribution
  },
  {
    id: 'terminal.toggle',
    area: PALETTE_AREA,
    data: {
      id: 'terminal.toggle',
      label: 'Toggle terminal',
      icon: Terminal,
      keywords: ['terminal', 'shell', 'console'],
      run: () => setTerminalTakeover(!$terminalTakeover.get())
    } satisfies PaletteContribution
  }
])

// ---------------------------------------------------------------------------
// Layout presets — CHAT (main) always dominates.
// ---------------------------------------------------------------------------

// The REAL default: sessions left, chat main, and the right sidebars in
// column order main | … | review | preview | file-browser (files outermost,
// preview DIRECTLY left of the file tree). Each is its OWN zone — main
// parity: a file double-click slides the preview open as its own pane beside
// the tree, never as a tab stacked into the files sidebar. Preview/review
// zones collapse to nothing while their pane is hidden (no target / ⌘G off).
// This static spot is just the seed — dockPaneBeside keeps preview adjacent
// to files WHEREVER files moves (see the target listeners below).
// 'sessions' (the sidebar) is CCF-bespoke chrome now, not a pane-tree zone —
// see the CcfSidebar wrapper in ContribController — so none of these trees
// reference it anymore.
const DEFAULT_TREE = split(
  'row',
  [
    group(['workspace'], { id: 'grp-main' }),
    split(
      'column',
      [
        split(
          'row',
          [
            group(['review'], { id: 'grp-review' }),
            group(['preview'], { id: 'grp-preview' }),
            group(['files'], { id: 'grp-files' })
          ],
          [1, 1, 1.2],
          'spl-rail'
        ),
        group(['terminal'], { id: 'grp-terminal' })
      ],
      [1.6, 1],
      'spl-right'
    )
  ],
  [3.4, 1.25],
  'spl-root'
)

const FOCUS_TREE = group(['workspace', 'files', 'preview', 'review', 'terminal'])

const TERMINAL_TREE = split(
  'column',
  [
    split('row', [group(['workspace']), group(['files', 'preview', 'review'])], [3.2, 1.2]),
    group(['terminal'])
  ],
  [3, 1]
)

const QUAD_TREE = split(
  'column',
  [
    split('row', [group(['files']), group(['workspace'])], [1, 3]),
    split('row', [group(['terminal']), group(['preview', 'review', 'logs'])], [1.4, 1])
  ],
  [3, 1]
)

registry.registerMany([
  { id: 'default', area: 'layouts', title: 'Default', order: 0, data: DEFAULT_TREE },
  { id: 'focus', area: 'layouts', title: 'Focus', order: 10, data: FOCUS_TREE },
  { id: 'terminal-deck', area: 'layouts', title: 'Terminal deck', order: 20, data: TERMINAL_TREE },
  { id: 'quad', area: 'layouts', title: 'Quad', order: 30, data: QUAD_TREE }
])

declareDefaultTree(DEFAULT_TREE)

// Bundled plugins load AFTER core, so a same-id contribution from a plugin
// deliberately overrides the core default (last writer wins). Third-party
// runtime plugins will flow through the same discovery seam.
discoverBundledPlugins()

// Plugin panes join the tree by their `placement` hint the moment they
// register — incl. runtime plugins arriving seconds after boot.
watchContributedPanes()

// Session + route (page) tiles: persisted splits register panes docked beside
// main.
watchSessionTiles()
watchRouteTiles()

// The main tab reads as its SESSION (the loaded title, "New session" on a
// fresh draft) — a stack of main + tiles is then just a row of session names.
// register() replaces same-id in place; the render fn is the shared constant
// above, so the pane content never remounts.
const syncWorkspaceTitle = () => {
  const selected = $selectedStoredSessionId.get()
  const stored = selected ? $sessions.get().find(s => sessionMatchesStoredId(s, selected)) : null

  registry.register({
    id: 'workspace',
    area: 'panes',
    title: stored ? storedSessionTitle(stored) : 'New session',
    data: {
      // Pages aren't tab-able: the main zone's bar stands down while one shows.
      headerVeto: $workspaceIsPage.get(),
      placement: 'main',
      minWidth: '22vw',
      tabDrag: workspaceTabDrag,
      tabWrap: wrapWorkspaceTab,
      uncloseable: true
    },
    render: renderWorkspacePane
  })
}

$selectedStoredSessionId.listen(syncWorkspaceTitle)
$sessions.listen(syncWorkspaceTitle)
$workspaceIsPage.listen(syncWorkspaceTitle)

// Layout reset collapses every session tile into main as a tab (after the
// workspace) instead of re-scattering them — pre-placed before adoption.
registerLayoutResetHandler(stackSessionTilesIntoMain)

// ---------------------------------------------------------------------------
// Titlebar chrome toggles -> tree. The TitlebarControls buttons keep their
// store semantics ($sidebarOpen / $fileBrowserOpen / $panesFlipped); the tree
// reacts — a hidden pane's zone collapses (content stays mounted), the flip
// toggle mirrors the root row.
// ---------------------------------------------------------------------------

function bindPaneVisibility(
  paneId: string,
  $open: { get(): boolean; listen(fn: (open: boolean) => void): void },
  close?: () => void,
  open?: () => void
) {
  setTreePaneHidden(paneId, !$open.get())
  $open.listen(isOpen => setTreePaneHidden(paneId, !isOpen))

  // The tab menu's Close routes through the owning store (never dismissal),
  // so the pane's toggle buttons stay truthful.
  if (close) {
    registerPaneCloser(paneId, close)
  }

  // The opener is the mirror: preset application (revealOnPreset) shows the
  // pane through the same store, so the toggle stays truthful.
  if (open) {
    registerPaneOpener(paneId, open)
  }
}

// TOOL PANELS (terminal, logs): like bindPaneVisibility but the toggle COLLAPSES
// the zone to a persistent rail (tab stays) instead of hiding it — the
// IntelliJ/VS-Code tool-window model. Restore routes back through `open` (rail
// click / chevron) so ⌃`/the button stay truthful; the tab's ✕ removes it.
function bindPaneCollapse(
  paneId: string,
  $open: { get(): boolean; listen(fn: (open: boolean) => void): void },
  close: () => void,
  open: () => void
) {
  markCollapsePane(paneId)
  setPaneCollapsed(paneId, !$open.get())
  $open.listen(isOpen => setPaneCollapsed(paneId, !isOpen))
  registerPaneCloser(paneId, close)
  registerPaneOpener(paneId, open)
}

// The sidebar is bespoke CCF chrome now, outside the pane tree entirely (see
// ContribController) — $panesFlipped/$sidebarOpen drive its side/visibility
// directly via plain conditional rendering, no tree syncing needed anymore
// (the old sessionsOnRight()-based sync — deriving $panesFlipped from where
// 'sessions' sat in the tree — is gone: 'sessions' can never appear in
// allPaneIds() again, so that sync was permanently inert dead code once the
// tree registration was removed).
//
// POSITIONAL side toggle (titlebar button, ⌘J): $fileBrowserOpen ≙ the RIGHT
// side of the main zone — everything on that side hides together, whatever
// panes have been rearranged there. (The equivalent LEFT-side binding for
// $sidebarOpen is gone too — binding it to "hide the tree's left side" would
// now incorrectly collapse the workspace/chat pane, since sessions no longer
// occupies that side at all.)
bindTreeSideVisibility('right', $fileBrowserOpen, setFileBrowserOpen)

// Workspace-scoped surfaces: the file tree and git diff only mean something
// inside a project. The terminal is NOT workspace-gated: unlike the old shell
// (where it rode the rail's row and vanished with it), its zone stands on its
// own.
const $hasWorkspace = computed($currentCwd, cwd => Boolean(cwd.trim()))

// Files no longer auto-reveals just because a session has a cwd (nearly every
// session does, so it was popping open on its own) — it now follows the same
// manual, user-controlled toggle as the titlebar button/⌘J ($fileBrowserOpen,
// defaults closed). "Reveal in Sidebar" already goes through this same store
// (revealFileInTree calls setFileBrowserOpen(true)), so that path is unaffected.
bindPaneVisibility('files', $fileBrowserOpen)
// ⌘G — the review sidebar appears/disappears (and comes to the front).
bindPaneVisibility(
  'review',
  computed([$reviewOpen, $hasWorkspace], (open, workspace) => open && workspace),
  closeReview
)
// ⌃` / statusbar toggle — the terminal COLLAPSES to a rail (tab stays), not
// hides; PTYs stay alive while collapsed (see PersistentTerminal).
bindPaneCollapse(
  'terminal',
  $terminalTakeover,
  () => setTerminalTakeover(false),
  () => setTerminalTakeover(true)
)

// Preview EXISTS only while something is previewed (old-shell semantics:
// closing the last preview tab closes the pane; a new target opens + fronts
// it). Same visibility binding as every other self-managed surface, driven
// by the live targets instead of a toggle.
const $previewVisible = computed([$previewTarget, $filePreviewTarget], (target, fileTarget) =>
  Boolean(target || fileTarget)
)

bindPaneVisibility('preview', $previewVisible, closeRightRail)

// Logs are optional chrome: off by default, toggled from ⌘K, persisted.
const $logsOpen = persistentAtom('hermes.desktop.logsOpen', false, Codecs.bool)

bindPaneCollapse(
  'logs',
  $logsOpen,
  () => $logsOpen.set(false),
  () => $logsOpen.set(true)
)
registry.register({
  id: 'logs.toggle',
  area: PALETTE_AREA,
  data: {
    id: 'logs.toggle',
    label: 'Toggle logs',
    keywords: ['logs', 'agent log', 'tail', 'debug'],
    run: () => $logsOpen.set(!$logsOpen.get())
  } satisfies PaletteContribution
})

// Files Close = collapse its side (⌘J truthful, titlebar button flips back)
// — but only while the pane actually lives in that root side column. Dragged
// next to main, a side collapse can't hide it (the collapse skips
// main-bearing children), so Close falls back to dismissal there —
// otherwise ⌘W/Close silently no-op. (Sessions/the sidebar no longer has an
// entry here — it's bespoke chrome outside the tree now, closed directly via
// setSidebarOpen, never dismissed as a tree pane.)
registerPaneCloser('files', () =>
  paneRootSide('files') === 'right' ? setFileBrowserOpen(false) : dismissTreePane('files')
)

// A preview target lands NEXT TO the file tree — position-aware: wherever
// files currently lives (default rail, ⌘\-flipped, dragged into a stack), the
// preview zone docks directly beside it. A user who drags the preview pane
// somewhere pins it there instead (until a preset/reset). Then reveal: open
// the side, unhide, front — a NEW target while already visible still fronts.
const revealPreview = () => {
  dockPaneBeside('preview', 'files')
  revealTreePane('preview')
}

$previewTarget.listen(target => target && revealPreview())
$filePreviewTarget.listen(target => target && revealPreview())

// ---------------------------------------------------------------------------

export function ContribController() {
  const sidebarOpen = useStore($sidebarOpen)
  const panesFlipped = useStore($panesFlipped)
  const sidebarWidth = useCcfSidebarWidth()

  const sidebar = sidebarOpen ? (
    <div className="relative h-full shrink-0" style={{ width: `${sidebarWidth}px` }}>
      <WiredPane part="sidebar" />
      <CcfSidebarResizeHandle side={panesFlipped ? 'left' : 'right'} />
    </div>
  ) : null

  return (
    <SidebarProvider
      className="h-screen min-h-0 flex-col bg-background"
      onOpenChange={setSidebarOpen}
      open={sidebarOpen}
      style={{ '--sidebar-width': '100%' } as CSSProperties}
    >
      <ContribWiring>
        <TranscriptAppearanceEffect />
        <div
          className="relative flex h-screen min-h-0 w-screen flex-col bg-(--ui-bg-chrome) p-2 text-(--ui-text-primary)"
          style={{ '--titlebar-height': '0px' } as CSSProperties}
        >
          {/* Title bar: floating chrome, absolutely positioned over the void
              (not a flex sibling anymore — see the pt-[34px] below, which
              replaces the space it used to claim by pushing the tree down).
              Composable via slots. Layout contract (no contribution can
              break it):
                - a full-bar DRAG BASE underneath (pointer-events-none, like
                  AppShell's drag strips) — everywhere without content drags
                  the window;
                - each slot region is width-fit, no-drag, pointer-events-auto,
                  so every contribution is clickable by construction;
                - LEFT/RIGHT slots align to the MAIN PANE's geometry via the
                  tree-published --workspace-left/right vars (pure CSS, no rect
                  threading), clamped to clear the REAL TitlebarControls
                  clusters (fixed, z-70); center is truly window-centered. */}
          <div className="absolute inset-x-0 top-0 z-30 flex h-[34px] items-center text-xs">
            {/* Drag strips, AppShell-style: cut to AVOID the fixed control
                clusters instead of overlapping them — Electron's no-drag
                carve-out of fixed/transformed elements is unreliable, so a
                full-bar drag base kills their clicks. In-flow slot content
                still carves via its own no-drag wrapper (the same pattern as
                the app's session-title button). */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 w-(--titlebar-controls-left,14px) [-webkit-app-region:drag]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-[calc(var(--titlebar-controls-left,14px)+(var(--titlebar-control-size,1.25rem)*2)+0.75rem)] right-[calc(var(--titlebar-tools-right,0.75rem)+var(--titlebar-tools-width,5.5rem)+0.75rem)] [-webkit-app-region:drag]"
            />
            {/* fixed + top-(--titlebar-controls-top), h-(--titlebar-control-height) —
                the EXACT same positioning/box-height TitlebarControls' own
                icon buttons use (see shell/titlebar-controls.tsx), not an
                independent absolute+items-center guess. translate-y-0.5
                matches the LEFT cluster specifically (sidebar toggle) —
                it carries that extra 2px shift the RIGHT cluster doesn't. */}
            <div
              className="pointer-events-auto fixed z-10 flex h-(--titlebar-control-height) w-max translate-y-0.5 items-center gap-2 [-webkit-app-region:no-drag]"
              style={{
                left: 'max(calc(var(--workspace-left, 0px) + 0.5rem), calc(var(--titlebar-controls-left, 14px) + 2 * var(--titlebar-control-size, 1.25rem) + 1rem))',
                top: 'var(--titlebar-controls-top, 6px)'
              }}
            >
              <SessionTitleLabel />
              <Slot area="titleBar.left" />
            </div>
            <div className="pointer-events-auto absolute left-1/2 top-1/2 z-10 flex w-max -translate-x-1/2 -translate-y-1/2 items-center gap-2 [-webkit-app-region:no-drag]">
              <Slot area="titleBar.center" />
            </div>
            <div
              className="pointer-events-auto absolute z-10 flex w-max items-center gap-2 [-webkit-app-region:no-drag]"
              style={{
                right:
                  'max(calc(var(--workspace-right, 0px) + 0.5rem), calc(var(--titlebar-tools-right, 0.75rem) + 4 * (var(--titlebar-control-size, 1.25rem) + 0.25rem) + 0.5rem))'
              }}
            >
              <Slot area="titleBar.right" />
            </div>
          </div>

          {/* CCF-bespoke sidebar sits beside the pane tree, not inside it —
              own floating card, own header clearance (pt-[34px] below
              matches the titlebar strip's height, replacing what doc-flow
              used to give the tree for free when the strip was a sibling
              instead of an absolute overlay). $panesFlipped only reorders
              these two flex children now; it no longer syncs against tree
              pane order (see the removed sessionsOnRight() sync above). */}
          <div className="relative flex min-h-0 flex-1 gap-2">
            {!panesFlipped && sidebar}
            <div className="relative flex min-h-0 flex-1 flex-col pt-[34px]">
              <LayoutTreeRoot />
            </div>
            {panesFlipped && sidebar}
          </div>

          {/* "Close running tab?" — the busy/input-blocked tile close gate. */}
          <SessionTileCloseConfirm />

          {/* The REAL statusbar (model pill, command center, agents, …) with
              statusBar.left/right contributions merged in. */}
          <WiredPane part="statusbar" />
        </div>
      </ContribWiring>
    </SidebarProvider>
  )
}

// Referenced type kept for plugin authors' reference (payload shape of
// statusBar.* contributions).
export type { StatusbarItem }
