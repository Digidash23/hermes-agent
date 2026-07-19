const EMPTY_ATTACHMENT_REFS: string[] = []

export function partText(part: unknown): string {
  if (typeof part === 'string') {
    return part
  }

  if (!part || typeof part !== 'object') {
    return ''
  }

  const row = part as { text?: unknown; type?: unknown }

  return (!row.type || row.type === 'text') && typeof row.text === 'string' ? row.text : ''
}

export function messageContentText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim()
  }

  return Array.isArray(content) ? content.map(partText).join('').trim() : ''
}

// Cheap streaming-stable "does this message have visible text" check: returns
// on the first non-whitespace text part without concatenating the whole
// message. Used as a useAuiState selector so its boolean output stays stable
// across token flushes (flips false→true once per turn).
export function contentHasVisibleText(content: unknown): boolean {
  if (typeof content === 'string') {
    return content.trim().length > 0
  }

  if (!Array.isArray(content)) {
    return false
  }

  for (const part of content) {
    if (partText(part).trim().length > 0) {
      return true
    }
  }

  return false
}

export function messageAttachmentRefs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return EMPTY_ATTACHMENT_REFS
  }

  return value.every(ref => typeof ref === 'string') ? value : EMPTY_ATTACHMENT_REFS
}

const IMAGE_ATTACHED_AT_RE = /^\[Image attached at: (.+)\]$/
const IMAGE_ATTACHED_URL_RE = /^\[Image attached: (.+)\]$/
const SCREENSHOT_PLACEHOLDER_RE = /^\[screenshot\]$/

export interface PersistedImageHints {
  cleanedText: string
  paths: string[]
}

/**
 * The live/optimistic attachmentRefs metadata (submit.ts) only ever exists
 * in memory for the session that sent the message — it doesn't survive a
 * reload. The backend deliberately doesn't persist image bytes either
 * (session DB bloat, not useful for cross-session replay — see
 * run_agent.py's session-db write) — a reloaded image turn's text instead
 * carries plain `[Image attached at: <path>]` / `[Image attached: <url>]`
 * hint lines plus one `[screenshot]` placeholder per image (source:
 * agent/image_routing.py's build_native_content_parts). Recognize those so
 * a reloaded turn still renders a thumbnail (re-read from the same local
 * path) instead of the raw hint text.
 */
export function extractPersistedImageHints(text: string): PersistedImageHints {
  const lines = text.split('\n')
  const paths: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    const atMatch = IMAGE_ATTACHED_AT_RE.exec(trimmed)

    if (atMatch) {
      paths.push(atMatch[1])

      continue
    }

    const urlMatch = IMAGE_ATTACHED_URL_RE.exec(trimmed)

    if (urlMatch) {
      paths.push(urlMatch[1])
    }
  }

  if (paths.length === 0) {
    return { cleanedText: text, paths: EMPTY_ATTACHMENT_REFS }
  }

  // Cap at exactly one stripped `[screenshot]` line per recognized hint —
  // if counts ever drift, leftover placeholder lines stay visible rather
  // than risking eating unrelated user-typed text that happens to match.
  let screenshotsToStrip = paths.length
  const kept: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (IMAGE_ATTACHED_AT_RE.test(trimmed) || IMAGE_ATTACHED_URL_RE.test(trimmed)) {
      continue
    }

    if (screenshotsToStrip > 0 && SCREENSHOT_PLACEHOLDER_RE.test(trimmed)) {
      screenshotsToStrip -= 1

      continue
    }

    kept.push(line)
  }

  return { cleanedText: kept.join('\n').trim(), paths }
}

export function pickPrimaryPreviewTarget(targets: string[]): string[] {
  if (targets.length <= 1) {
    return targets
  }

  const localUrl = targets.find(value => /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(value))

  return [localUrl || targets[targets.length - 1]]
}
