// Exposes the browser-workstation panel to the Electron main process as a
// handful of plain window.* functions, so electron/browser-workstation-mcp-server.ts
// can drive it via win.webContents.executeJavaScript(...) — that call reaches
// the page's real world regardless of contextIsolation (that setting only
// isolates the preload script from page scripts, not main-process injection).
// Mirrors the pattern already proven out in the older Nova desktop app
// (packages/desktop/src/settings.js + workstation.js's window.openWebpage /
// window.fillWebviewField / window.getWorkstationWebviewRect).
import {
  $browserTabs,
  $browserWorkstationOpen,
  $effectiveActiveBrowserTabId,
  openBrowserTab,
  setBrowserTabUrl
} from '@/store/browser-workstation'

import { normalizeUrlOrSearch } from './normalize-url'
import { getWorkstationWebview } from './webview-registry'

interface FillFieldResult {
  error?: string
  ok: boolean
}

interface RectResult {
  error?: string
  height?: number
  ok: boolean
  width?: number
  x?: number
  y?: number
}

// Runs inside the guest page (via <webview>.executeJavaScript), so it can't
// close over anything from this module — everything it needs is passed in as
// a literal, JSON-encoded argument baked into the script string.
function buildFillFieldScript(fieldDescription: string, value: string): string {
  return `(function() {
    const desc = ${JSON.stringify(fieldDescription.toLowerCase())};
    const val = ${JSON.stringify(value)};
    const inputs = [...document.querySelectorAll('input, textarea')];
    function scoreInput(el) {
      const text = [
        el.placeholder, el.getAttribute('aria-label'), el.name, el.id,
        el.closest('label') ? el.closest('label').textContent : '',
        el.previousElementSibling ? el.previousElementSibling.textContent : '',
        el.parentElement ? el.parentElement.textContent.slice(0, 60) : ''
      ].filter(Boolean).join(' ').toLowerCase();
      let score = 0;
      desc.split(/\\s+/).forEach(word => { if (word.length > 2 && text.includes(word)) score++; });
      if (el.type === 'number' || el.inputMode === 'decimal') score += 0.5;
      return score;
    }
    let best = null, bestScore = -1;
    for (const el of inputs) {
      if (el.disabled || el.readOnly || el.offsetParent === null) continue;
      const s = scoreInput(el);
      if (s > bestScore) { bestScore = s; best = el; }
    }
    if (!best || bestScore <= 0) return { ok: false, error: 'no matching field found on the page' };
    const proto = best.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(best, val);
    best.dispatchEvent(new Event('input', { bubbles: true }));
    best.dispatchEvent(new Event('change', { bubbles: true }));
    best.blur();
    return { ok: true };
  })();`
}

export function openWebpage(query: string): { ok: true } {
  const url = normalizeUrlOrSearch(query)

  $browserWorkstationOpen.set(true)

  const activeId = $effectiveActiveBrowserTabId.get()
  const activeTab = $browserTabs.get().find(tab => tab.id === activeId)

  if (activeTab) {
    setBrowserTabUrl(activeTab.id, url)
  } else {
    openBrowserTab(url)
  }

  return { ok: true }
}

export async function fillWebviewField(fieldDescription: string, value: string): Promise<FillFieldResult> {
  const webview = getWorkstationWebview($effectiveActiveBrowserTabId.get())

  if (!webview?.executeJavaScript) {
    return { ok: false, error: 'No page is open in the workstation panel' }
  }

  try {
    const result = await webview.executeJavaScript(buildFillFieldScript(fieldDescription, value))

    return result as FillFieldResult
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Lets the MCP server's capture_workstation_screenshot tool (see
// electron/browser-workstation-mcp-server.ts) know exactly where to crop —
// calling <webview>.capturePage() directly from the main process is
// unreliable (it's a separately GPU-composited guest surface and commonly
// returns a solid black frame), so the main process instead captures the
// whole window and crops to this rect, which correctly composites the
// webview's real content in.
export function getActiveTabRect(): RectResult {
  const webview = getWorkstationWebview($effectiveActiveBrowserTabId.get())

  if (!webview) {
    return { ok: false, error: 'No page is open in the workstation panel' }
  }

  const rect = webview.getBoundingClientRect()

  return { ok: true, x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

declare global {
  interface Window {
    __ccfWorkstation?: {
      fillWebviewField: typeof fillWebviewField
      getActiveTabRect: typeof getActiveTabRect
      openWebpage: typeof openWebpage
    }
  }
}

window.__ccfWorkstation = { fillWebviewField, getActiveTabRect, openWebpage }
