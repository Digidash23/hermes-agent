// Pure timeline helpers — no React/DOM; tested in thread-timeline-data.test.ts.

export interface TimelineSourceMessage {
  id: string
  text: string
}

export interface TimelineEntry {
  id: string
  preview: string
}

const PREVIEW_MAX = 120

export function timelinePreview(text: string, max: number = PREVIEW_MAX): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()

  if (collapsed.length <= max) {
    return collapsed
  }

  return `${collapsed.slice(0, max - 1).trimEnd()}…`
}

// Order follows `messages` (thread/chronological order), not pin order — the
// rail's ticks are positioned by scroll offset, so entries need to read
// top-to-bottom the same way the thread does.
export function deriveTimelineEntries(
  messages: readonly TimelineSourceMessage[],
  pinnedIds: ReadonlySet<string>
): TimelineEntry[] {
  const entries: TimelineEntry[] = []

  for (const message of messages) {
    if (!pinnedIds.has(message.id)) {
      continue
    }

    const text = message.text.trim()

    if (!text) {
      continue
    }

    entries.push({ id: message.id, preview: timelinePreview(text) })
  }

  return entries
}

/** Last user prompt at/above the viewport top (with slack); else first rendered. */
export function activeTimelineIndex(offsets: readonly (number | null)[], slack: number = 8): number {
  let active = -1
  let firstRendered = -1

  for (let i = 0; i < offsets.length; i++) {
    const offset = offsets[i]

    if (offset == null) {
      continue
    }

    if (firstRendered === -1) {
      firstRendered = i
    }

    if (offset <= slack) {
      active = i
    }
  }

  if (active !== -1) {
    return active
  }

  return firstRendered === -1 ? 0 : firstRendered
}
