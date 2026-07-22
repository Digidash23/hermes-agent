import { atom, computed } from 'nanostores'

import { Codecs, persistentAtom } from '@/lib/persisted'

export interface BrowserTab {
  favicon: string
  id: string
  title: string
  url: string
}

// Empty url = the tab hasn't navigated yet — it shows the search/URL entry
// screen instead of a webview. Only way to reach that screen is a new tab.
function makeTab(url = ''): BrowserTab {
  return { favicon: '', id: crypto.randomUUID(), title: '', url }
}

// Normalizes rather than strictly validates — a persisted tab missing a field
// added after it was saved (e.g. favicon, added later) gets that field
// defaulted instead of the whole tab being dropped on load.
function toBrowserTab(value: unknown): BrowserTab | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>

  if (typeof record.id !== 'string' || typeof record.url !== 'string') {
    return null
  }

  return {
    favicon: typeof record.favicon === 'string' ? record.favicon : '',
    id: record.id,
    title: typeof record.title === 'string' ? record.title : '',
    url: record.url
  }
}

function sanitizeTabs(value: unknown): BrowserTab[] {
  if (!Array.isArray(value)) {
    return [makeTab()]
  }

  const tabs = value.map(toBrowserTab).filter((tab): tab is BrowserTab => tab !== null)

  return tabs.length > 0 ? tabs : [makeTab()]
}

export const $browserWorkstationOpen = persistentAtom('hermes.desktop.browserWorkstation.open', false, Codecs.bool)

// Not persisted — same as a real browser, fullscreen is a transient view
// state you re-enter each time, not something that should silently reopen
// exactly as you left it on the next launch.
export const $browserWorkstationFullscreen = atom(false)

export const $browserTabs = persistentAtom<BrowserTab[]>(
  'hermes.desktop.browserWorkstation.tabs',
  [makeTab()],
  Codecs.json(sanitizeTabs)
)

export const $activeBrowserTabId = persistentAtom(
  'hermes.desktop.browserWorkstation.activeTabId',
  $browserTabs.get()[0].id,
  Codecs.text
)

// Falls back to the first tab whenever the persisted active id doesn't match
// any current tab (e.g. that tab was closed in a previous session).
export const $effectiveActiveBrowserTabId = computed([$browserTabs, $activeBrowserTabId], (tabs, activeId) =>
  tabs.some(tab => tab.id === activeId) ? activeId : (tabs[0]?.id ?? '')
)

export function toggleBrowserWorkstation() {
  $browserWorkstationOpen.set(!$browserWorkstationOpen.get())
}

export function closeBrowserWorkstation() {
  $browserWorkstationOpen.set(false)
  $browserWorkstationFullscreen.set(false)
}

export function toggleBrowserWorkstationFullscreen() {
  $browserWorkstationFullscreen.set(!$browserWorkstationFullscreen.get())
}

export function exitBrowserWorkstationFullscreen() {
  $browserWorkstationFullscreen.set(false)
}

export function setActiveBrowserTab(id: string) {
  $activeBrowserTabId.set(id)
}

export function openBrowserTab(url = '') {
  const tab = makeTab(url)

  $browserTabs.set([...$browserTabs.get(), tab])
  $activeBrowserTabId.set(tab.id)
}

export function closeBrowserTab(id: string) {
  const tabs = $browserTabs.get()
  const index = tabs.findIndex(tab => tab.id === id)

  if (index === -1) {
    return
  }

  const remaining = tabs.filter(tab => tab.id !== id)

  if (remaining.length === 0) {
    const fresh = makeTab()

    $browserTabs.set([fresh])
    $activeBrowserTabId.set(fresh.id)

    return
  }

  $browserTabs.set(remaining)

  if ($activeBrowserTabId.get() === id) {
    const fallback = remaining[Math.min(index, remaining.length - 1)]

    $activeBrowserTabId.set(fallback.id)
  }
}

export function setBrowserTabUrl(id: string, url: string) {
  $browserTabs.set($browserTabs.get().map(tab => (tab.id === id ? { ...tab, url } : tab)))
}

export function setBrowserTabTitle(id: string, title: string) {
  $browserTabs.set($browserTabs.get().map(tab => (tab.id === id ? { ...tab, title } : tab)))
}

export function setBrowserTabFavicon(id: string, favicon: string) {
  $browserTabs.set($browserTabs.get().map(tab => (tab.id === id ? { ...tab, favicon } : tab)))
}
