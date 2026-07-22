// Shared, non-React registry of each tab's live <webview> DOM element, keyed
// by tab id. BrowserWorkstationPanel already tracks these in a component-local
// ref for its own nav buttons (back/forward/reload) — this mirrors that into a
// module-level map so code outside the React tree (the MCP bridge in
// workstation-mcp-bridge.ts, itself called from the Electron main process via
// executeJavaScript) can reach the active tab's webview too, without needing
// to be a descendant of BrowserWorkstationPanel.
export type WebviewEl = HTMLElement & {
  canGoBack?(): boolean
  canGoForward?(): boolean
  executeJavaScript?(code: string): Promise<unknown>
  goBack?(): void
  goForward?(): void
  reload?(): void
  src?: string
}

const registry = new Map<string, WebviewEl>()

export function registerWorkstationWebview(id: string, el: null | WebviewEl): void {
  if (el) {
    registry.set(id, el)
  } else {
    registry.delete(id)
  }
}

export function getWorkstationWebview(id: string): WebviewEl | null {
  return registry.get(id) ?? null
}
