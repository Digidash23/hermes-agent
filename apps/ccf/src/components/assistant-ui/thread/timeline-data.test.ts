import { describe, expect, it } from 'vitest'

import { activeTimelineIndex, deriveTimelineEntries, timelinePreview } from './timeline-data'

describe('timelinePreview', () => {
  it('collapses whitespace to a single line', () => {
    expect(timelinePreview('hello\n\n  world\tagain')).toBe('hello world again')
  })

  it('truncates with an ellipsis past the limit', () => {
    const out = timelinePreview('abcdefghij', 5)
    expect(out).toBe('abcd…')
    expect(out.length).toBe(5)
  })
})

describe('deriveTimelineEntries', () => {
  it('keeps only pinned messages, in thread order', () => {
    expect(
      deriveTimelineEntries(
        [
          { id: 'u1', text: 'first' },
          { id: 'a1', text: 'answer' },
          { id: 'u2', text: '  second  ' }
        ],
        new Set(['u1', 'u2'])
      )
    ).toEqual([
      { id: 'u1', preview: 'first' },
      { id: 'u2', preview: 'second' }
    ])
  })

  it('drops blanks even if pinned, and ignores unpinned messages', () => {
    expect(
      deriveTimelineEntries(
        [
          { id: 'u1', text: '   ' },
          { id: 'u2', text: 'not pinned' },
          { id: 'u3', text: 'real prompt' }
        ],
        new Set(['u1', 'u3'])
      ).map(e => e.id)
    ).toEqual(['u3'])
  })
})

describe('activeTimelineIndex', () => {
  it('returns the last prompt scrolled to or above the top edge', () => {
    expect(activeTimelineIndex([-400, -10, 320])).toBe(1)
  })

  it('falls back to the first rendered entry', () => {
    expect(activeTimelineIndex([null, 120, 480])).toBe(1)
    expect(activeTimelineIndex([null, null])).toBe(0)
  })
})
