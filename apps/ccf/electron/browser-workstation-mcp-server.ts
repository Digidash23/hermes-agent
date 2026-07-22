// A local MCP server that lets the agent see and drive CCF's own
// browser-workstation panel — the tabbed <webview> browser visible in the
// app's own UI. Without this, the agent's native browser_* tools (via
// hermes-agent's agent-browser/CDP layer) operate on a browser session the
// user can't see and, per the panel being a local Electron surface, can't
// even reach at all (blocked by the browser tool's own local-address guard).
//
// Mirrors the pattern already proven out in the older Nova desktop app (see
// packages/desktop/mcp-server.js in the activepieces-main repo): stateless
// Streamable HTTP, a fresh Server + Transport per request, torn down when the
// connection closes — no persistent process for a client to hold open.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'

const TOOLS = [
  {
    name: 'open_webpage',
    description:
      "Opens a website or search in the CCF desktop app's browser-workstation panel (the browser panel visible to the user). Use this whenever the user asks to pull up, open, go to, search for, or navigate to a site or a search query.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: "A URL (e.g. 'tradingview.com') or a search query" }
      },
      required: ['query']
    }
  },
  {
    name: 'fill_webview_field',
    description:
      'Enters a value into an input field on the web page currently loaded in the browser-workstation panel. Use this whenever the user asks to type, enter, or fill in a value on the page they have open.',
    inputSchema: {
      type: 'object',
      properties: {
        field_description: {
          type: 'string',
          description: "A short description of which field to fill, e.g. 'the sell amount input' or 'the search box'"
        },
        value: { type: 'string', description: 'The value to type into the field' }
      },
      required: ['field_description', 'value']
    }
  },
  {
    name: 'capture_workstation_screenshot',
    description:
      "Takes a screenshot of the CCF desktop app's own browser-workstation panel — the actual browser panel the user is looking at on their screen right now. This is the ONLY tool that can see what the user has open in that panel. Any other browser/vision tool you have (browser_navigate, browser_snapshot, etc.) operates on a completely separate, invisible browser session the user cannot see — never use those to answer questions like 'can you see this', 'what's on my screen', or 'what am I looking at'. Always call this tool instead whenever the user is asking about their own browser-workstation panel, even right after calling open_webpage or fill_webview_field.",
    inputSchema: { type: 'object', properties: {}, required: [] }
  }
]

// The server binds to loopback only, but loopback still means "any process
// on this machine" — without a shared secret, anything local could POST here
// and drive the workstation panel's navigation/field-filling. Generated once
// and persisted outside the repo (Electron's userData dir), so it survives
// restarts but is never checked into git.
export function getOrCreateWorkstationMcpKey(): string {
  const keyPath = path.join(app.getPath('userData'), 'workstation-mcp-key.txt')

  try {
    const existing = fs.readFileSync(keyPath, 'utf8').trim()

    if (existing) {
      return existing
    }
  } catch {
    // No key on disk yet — fall through and mint one.
  }

  const key = crypto.randomBytes(24).toString('hex')

  fs.writeFileSync(keyPath, key, { mode: 0o600 })

  return key
}

async function captureWorkstationPng(win: BrowserWindow): Promise<{ dataUrl?: string; error?: string; ok: boolean }> {
  const rect = (await win.webContents.executeJavaScript(
    'window.__ccfWorkstation?.getActiveTabRect() ?? { ok: false, error: "workstation bridge not installed" }'
  )) as { error?: string; height?: number; ok: boolean; width?: number; x?: number; y?: number }

  if (!rect.ok || rect.x === undefined || rect.y === undefined || !rect.width || !rect.height) {
    return { ok: false, error: rect.error ?? 'No page is open in the workstation panel' }
  }

  const image = await win.webContents.capturePage({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  })

  return { ok: true, dataUrl: 'data:image/png;base64,' + image.toPNG().toString('base64') }
}

function buildServer(getWindow: () => BrowserWindow | null): Server {
  const server = new Server({ name: 'ccf-workstation', version: '1.0.0' }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const win = getWindow()

    if (!win || win.isDestroyed()) {
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'CCF window is not available' }) }] }
    }

    const { name, arguments: args } = request.params as { arguments?: Record<string, unknown>; name: string }
    let result: unknown

    try {
      // Runs the renderer functions installed by workstation-mcp-bridge.ts.
      // executeJavaScript from the main process reaches the page's real world
      // regardless of contextIsolation (that setting only isolates the
      // preload script from page scripts, not main-process injection).
      if (name === 'open_webpage') {
        result = await win.webContents.executeJavaScript(
          `window.__ccfWorkstation.openWebpage(${JSON.stringify(args?.query)})`
        )
      } else if (name === 'fill_webview_field') {
        result = await win.webContents.executeJavaScript(
          `window.__ccfWorkstation.fillWebviewField(${JSON.stringify(args?.field_description)}, ${JSON.stringify(args?.value)})`
        )
      } else if (name === 'capture_workstation_screenshot') {
        const capture = await captureWorkstationPng(win)

        if (!capture.ok || !capture.dataUrl) {
          return { content: [{ type: 'text', text: JSON.stringify(capture) }] }
        }

        const base64 = capture.dataUrl.slice(capture.dataUrl.indexOf(',') + 1)

        return { content: [{ type: 'image', mimeType: 'image/png', data: base64 }] }
      } else {
        result = { ok: false, error: 'Unknown tool: ' + name }
      }
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) }
    }

    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  })

  return server
}

// Registers the workstation MCP server in HERMES_HOME/config.yaml so the
// agent picks it up as a normal tool on backend startup — same mechanism as
// any other user-configured MCP server (see hermes_cli/mcp_startup.py).
// config.yaml is a real file the user's own settings already live in (model,
// approvals, toolsets, ...), so this only ever touches our own
// `mcp_servers.ccf-workstation` entry — a plain text patch, not a full
// YAML-library rewrite, so nothing else in the file is touched or
// reformatted. Safe to call on every backend start; idempotent.
export function ensureWorkstationMcpConfig(configPath: string, port: number, key: string): void {
  const entryLines = [
    '  ccf-workstation:',
    `    url: http://127.0.0.1:${port}`,
    '    headers:',
    `      Authorization: Bearer ${key}`,
    '    enabled: true'
  ]

  let content = ''

  try {
    content = fs.readFileSync(configPath, 'utf8')
  } catch {
    // No config.yaml yet — we'll create one below.
  }

  const lines = content.length > 0 ? content.split('\n') : []
  const mcpServersIndex = lines.findIndex(line => /^mcp_servers:\s*$/.test(line))

  if (mcpServersIndex === -1) {
    const trimmed = content.replace(/\s*$/, '')
    const next = (trimmed ? trimmed + '\n' : '') + ['mcp_servers:', ...entryLines, ''].join('\n')

    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, next)

    return
  }

  let blockEnd = mcpServersIndex + 1

  while (blockEnd < lines.length && lines[blockEnd].startsWith('  ')) {
    blockEnd++
  }

  const existingEntryIndex = lines.findIndex(
    (line, i) => i > mcpServersIndex && i < blockEnd && /^\s{2}ccf-workstation:\s*$/.test(line)
  )

  if (existingEntryIndex !== -1) {
    let existingEnd = existingEntryIndex + 1

    while (existingEnd < blockEnd && lines[existingEnd].startsWith('    ')) {
      existingEnd++
    }

    lines.splice(existingEntryIndex, existingEnd - existingEntryIndex, ...entryLines)
  } else {
    lines.splice(mcpServersIndex + 1, 0, ...entryLines)
  }

  fs.writeFileSync(configPath, lines.join('\n'))
}

export function startWorkstationMcpServer(getWindow: () => BrowserWindow | null, port: number): http.Server {
  const key = getOrCreateWorkstationMcpKey()

  const httpServer = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Method Not Allowed — use POST' }))

      return
    }

    const authHeader = req.headers.authorization || ''

    if (authHeader !== 'Bearer ' + key) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))

      return
    }

    let body = ''

    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', async () => {
      let parsedBody: unknown

      try {
        parsedBody = body ? JSON.parse(body) : undefined
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))

        return
      }

      const server = buildServer(getWindow)
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })

      res.on('close', () => {
        void transport.close()
        void server.close()
      })

      try {
        await server.connect(transport)
        await transport.handleRequest(req, res, parsedBody)
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
        }
      }
    })
  })

  httpServer.listen(port, '127.0.0.1', () => {
    console.log('[ccf-workstation-mcp] listening on http://127.0.0.1:' + port)
  })

  return httpServer
}
