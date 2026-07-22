import { useStore } from '@nanostores/react'
import { memo, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  $browserTabs,
  $browserWorkstationFullscreen,
  $effectiveActiveBrowserTabId,
  type BrowserTab,
  closeBrowserTab,
  closeBrowserWorkstation,
  openBrowserTab,
  setActiveBrowserTab,
  setBrowserTabFavicon,
  setBrowserTabTitle,
  setBrowserTabUrl,
  toggleBrowserWorkstationFullscreen
} from '@/store/browser-workstation'

import { BrowserWorkstationResizeHandle, useBrowserWorkstationWidth } from '../shell/browser-workstation-resize'

type WebviewEl = HTMLElement & {
  canGoBack?(): boolean
  canGoForward?(): boolean
  goBack?(): void
  goForward?(): void
  reload?(): void
  src?: string
}

const HEADER_ACTION_CLASS = 'text-foreground/90 hover:bg-white/8! hover:text-foreground!'

function normalizeUrlOrSearch(input: string): string {
  const trimmed = input.trim()

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }

  return trimmed.includes('.') && !trimmed.includes(' ')
    ? `https://${trimmed}`
    : `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

// Owns the width subscription so dragging the resize handle only re-renders
// this small wrapper, not the whole app shell. ContribController used to call
// useBrowserWorkstationWidth() itself, which meant every pointermove during a
// drag re-rendered the ENTIRE shell — sidebar, chat panes, titlebar, all of
// it — since they're all part of the same component tree underneath it.
// BrowserWorkstationPanel is memoized (it takes no props) specifically so
// THIS component re-rendering for its own width doesn't cascade into it too.
export function BrowserWorkstationDock() {
  const width = useBrowserWorkstationWidth()
  const fullscreen = useStore($browserWorkstationFullscreen)

  if (fullscreen) {
    // Fixed overlay covering the whole window, same p-2 inset as the shell
    // itself uses — bypasses the flex row and its width math entirely rather
    // than trying to make the drag-resize width math also account for a
    // "take everything" state. No resize handle: dragging doesn't mean
    // anything while the panel already fills the screen.
    return (
      <div className="fixed inset-0 z-[100] p-2">
        <BrowserWorkstationPanel />
      </div>
    )
  }

  return (
    <div className="relative h-full shrink-0" style={{ width: `${width}px` }}>
      <BrowserWorkstationPanel />
      <BrowserWorkstationResizeHandle side="left" />
    </div>
  )
}

// Mirrors ChatSidebar's exact floating-card treatment (see chat/sidebar/index.tsx)
// so the two read as the same physical object on opposite edges of the window.
// Deliberately rendered OUTSIDE the pane tree (see contrib/controller.tsx) —
// the tree's seam-invariant CSS zeroes border-radius/borders on anything
// docked inside it, which is why this can't be a registered tree pane.
const BrowserWorkstationPanel = memo(function BrowserWorkstationPanel() {
  const tabs = useStore($browserTabs)
  const activeTabId = useStore($effectiveActiveBrowserTabId)
  const fullscreen = useStore($browserWorkstationFullscreen)
  // Per-tab webview elements, keyed by tab id — the nav buttons live in this
  // shared header row now, so they need to reach whichever tab is active.
  const webviewsRef = useRef(new Map<string, WebviewEl>())

  const registerWebview = (id: string, el: null | WebviewEl) => {
    if (el) {
      webviewsRef.current.set(id, el)
    } else {
      webviewsRef.current.delete(id)
    }
  }

  const activeWebview = () => webviewsRef.current.get(activeTabId) ?? null

  const handleBack = () => {
    const webview = activeWebview()

    if (webview?.canGoBack?.()) {
      webview.goBack?.()
    }
  }

  const handleForward = () => {
    const webview = activeWebview()

    if (webview?.canGoForward?.()) {
      webview.goForward?.()
    }
  }

  const handleReload = () => activeWebview()?.reload?.()

  return (
    <div
      className={cn(
        // z-40: the app's floating titlebar strip (contrib/controller.tsx) is an
        // absolute, full-width z-30 overlay for window-dragging. It has no
        // content over this panel's area, but with no z-index of our own it
        // still wins hit-testing there by stacking order, swallowing clicks on
        // the header row below. Stacking above it — not shoving content down
        // past it — is what actually fixes "can't click the tabs."
        'relative z-40 flex h-full min-w-0 flex-col overflow-hidden rounded-[16px] border text-foreground',
        'border-(--sidebar-edge-border)',
        'bg-[color-mix(in_srgb,var(--dt-card)_72%,transparent)]',
        'backdrop-blur-[0.75rem] backdrop-saturate-[1.12] [-webkit-backdrop-filter:blur(0.75rem)_saturate(1.12)]'
      )}
    >
      {/* Single header row: tabs, new-tab, nav controls, close — all in one
          band now, no separate URL-bar row. In full screen, the panel's left
          edge sits at the window's actual left edge for the first time — right
          where macOS's native traffic-light window controls live. Those are
          OS chrome, not ours, and render on top regardless of z-index, so the
          only fix is not putting content there: same left clearance formula
          contrib/controller.tsx uses for its own titlebar row. */}
      <div
        className={cn(
          'flex h-9 shrink-0 items-center gap-1 px-1.5 [-webkit-app-region:no-drag]',
          fullscreen && 'pl-[calc(var(--titlebar-controls-left,14px)+2*var(--titlebar-control-size,1.25rem)+1rem)]'
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map(tab => (
            // flex-1 + min/max width: tabs grow to show more of their title
            // when there's room, and shrink together (down to min-width) as
            // more open up — same give-way behavior real browser tabs have.
            <BrowserTabChip active={tab.id === activeTabId} key={tab.id} tab={tab} />
          ))}
          <Tip label="New tab">
            <Button
              aria-label="New tab"
              className={cn(HEADER_ACTION_CLASS, 'shrink-0')}
              onClick={() => openBrowserTab()}
              size="icon-xs"
              variant="ghost"
            >
              <Codicon name="add" size="0.75rem" />
            </Button>
          </Tip>
        </div>
        <Tip label="Back">
          <Button aria-label="Back" className={HEADER_ACTION_CLASS} onClick={handleBack} size="icon-xs" variant="ghost">
            <Codicon name="arrow-left" size="0.8125rem" />
          </Button>
        </Tip>
        <Tip label="Forward">
          <Button
            aria-label="Forward"
            className={HEADER_ACTION_CLASS}
            onClick={handleForward}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="arrow-right" size="0.8125rem" />
          </Button>
        </Tip>
        <Tip label="Reload">
          <Button
            aria-label="Reload"
            className={HEADER_ACTION_CLASS}
            onClick={handleReload}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="refresh" size="0.8125rem" />
          </Button>
        </Tip>
        <Tip label={fullscreen ? 'Exit full screen' : 'Full screen'}>
          <Button
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            className={HEADER_ACTION_CLASS}
            onClick={toggleBrowserWorkstationFullscreen}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name={fullscreen ? 'screen-normal' : 'screen-full'} size="0.75rem" />
          </Button>
        </Tip>
        <Tip label="Close">
          <Button
            aria-label="Close"
            className={HEADER_ACTION_CLASS}
            onClick={closeBrowserWorkstation}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="close" size="0.75rem" />
          </Button>
        </Tip>
      </div>

      {tabs.map(tab => (
        <BrowserTabView
          active={tab.id === activeTabId}
          key={tab.id}
          onWebviewRef={el => registerWebview(tab.id, el)}
          tab={tab}
        />
      ))}
    </div>
  )
})

function BrowserTabChip({ active, tab }: { active: boolean; tab: BrowserTab }) {
  return (
    <div
      aria-selected={active}
      className={cn(
        'group flex h-6 min-w-20 max-w-60 flex-1 cursor-default items-center gap-1.5 rounded-full px-2 text-[0.75rem]',
        active ? 'bg-white/10 text-foreground' : 'text-muted-foreground/70 hover:bg-white/5'
      )}
      onClick={() => setActiveBrowserTab(tab.id)}
      role="tab"
    >
      {tab.favicon ? (
        <img alt="" className="size-3.5 shrink-0 rounded-[2px]" src={tab.favicon} />
      ) : (
        <Codicon className="shrink-0 opacity-60" name="globe" size="0.75rem" />
      )}
      <span className="min-w-0 flex-1 truncate">{tab.title || 'New tab'}</span>
      <button
        aria-label="Close tab"
        className="shrink-0 rounded-sm p-0.5 opacity-0 hover:bg-white/10 group-hover:opacity-100"
        onClick={event => {
          event.stopPropagation()
          closeBrowserTab(tab.id)
        }}
        type="button"
      >
        <Codicon name="close" size="0.625rem" />
      </button>
    </div>
  )
}

// Each tab keeps its own mounted <webview> (hidden, not unmounted, while
// inactive) so switching tabs preserves scroll position, history, and any
// in-page state. Before the tab has navigated (tab.url is empty), it shows
// a search/URL entry screen instead — no webview exists yet.
function BrowserTabView({
  active,
  onWebviewRef,
  tab
}: {
  active: boolean
  onWebviewRef: (el: null | WebviewEl) => void
  tab: BrowserTab
}) {
  const [searchValue, setSearchValue] = useState('')
  const webviewRef = useRef<WebviewEl>(null)
  const hasNavigated = Boolean(tab.url)

  // The webview only mounts once tab.url goes from empty to set (the two
  // branches below are different element trees) — this registers/unregisters
  // it with the parent's ref map at exactly that transition.
  useEffect(() => {
    onWebviewRef(webviewRef.current)

    return () => onWebviewRef(null)
  }, [hasNavigated, onWebviewRef])

  useEffect(() => {
    const webview = webviewRef.current

    if (webview && tab.url) {
      webview.src = tab.url
    }
  }, [tab.url])

  useEffect(() => {
    const webview = webviewRef.current

    if (!webview) {
      return
    }

    const onTitleUpdate = (event: Event) => {
      const title = (event as Event & { title?: string }).title

      if (typeof title === 'string') {
        setBrowserTabTitle(tab.id, title)
      }
    }

    webview.addEventListener('page-title-updated', onTitleUpdate)

    return () => webview.removeEventListener('page-title-updated', onTitleUpdate)
  }, [tab.id, tab.url])

  useEffect(() => {
    const webview = webviewRef.current

    if (!webview) {
      return
    }

    const onFaviconUpdate = (event: Event) => {
      const favicons = (event as Event & { favicons?: unknown }).favicons
      const favicon = Array.isArray(favicons) ? favicons[0] : undefined

      if (typeof favicon === 'string') {
        setBrowserTabFavicon(tab.id, favicon)
      }
    }

    webview.addEventListener('page-favicon-updated', onFaviconUpdate)

    return () => webview.removeEventListener('page-favicon-updated', onFaviconUpdate)
  }, [tab.id, tab.url])

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = searchValue.trim()

    if (!trimmed) {
      return
    }

    setBrowserTabUrl(tab.id, normalizeUrlOrSearch(trimmed))
  }

  if (!tab.url) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6', !active && 'hidden')}>
        <form className="w-full max-w-sm" onSubmit={handleSearchSubmit}>
          <Input
            autoFocus={active}
            className="rounded-full bg-white/5 text-center text-[0.8125rem]"
            onChange={event => setSearchValue(event.target.value)}
            placeholder="Search or enter a URL"
            size="sm"
            type="text"
            value={searchValue}
          />
        </form>
      </div>
    )
  }

  return (
    <div className={cn('min-h-0 w-full flex-1 overflow-hidden', !active && 'hidden')}>
      <webview
        className="h-full w-full"
        nodeintegration={false}
        partition="persist:browser-workstation"
        ref={webviewRef}
      />
    </div>
  )
}
