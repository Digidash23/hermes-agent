import type { FC } from 'react'
import { Fragment, useMemo } from 'react'

import { DirectiveContent } from '@/components/assistant-ui/directive-text'
import { detectEmbed, type EmbedDescriptor, UrlEmbed } from '@/components/assistant-ui/embeds'
import { EXPLICIT_URL_RE, normalizeExternalUrl } from '@/lib/external-link'
import { cn } from '@/lib/utils'

// User messages should render the bare-minimum of markdown: backtick `code`
// spans and ``` fenced blocks. We deliberately don't pull in the full
// assistant Markdown pipeline (Streamdown + KaTeX + syntax highlighter)
// because user input rarely contains structured docs and the heavy pipeline
// adds a lot of runtime cost per bubble.
//
// Directive chips (`@file:`, `@image:`, ...) still resolve via DirectiveContent
// inside the plain-text segments. Bare embeddable URLs (youtu.be, etc.) also
// resolve to a rich UrlEmbed — same detectEmbed/UrlEmbed the assistant's full
// markdown pipeline uses (markdown-text.tsx), just detected directly off the
// raw text here instead of via a markdown autolink AST node. Both pieces are
// self-contained and lazy-loaded, so this doesn't pull in the heavy pipeline
// this file otherwise avoids.

interface FenceSegment {
  kind: 'fence'
  code: string
  lang: string | null
}

interface InlineSegment {
  kind: 'inline'
  text: string
}

interface InlineCodeSegment {
  kind: 'inline-code'
  code: string
}

interface InlineTextSegment {
  kind: 'inline-text'
  text: string
}

type TopSegment = FenceSegment | InlineSegment
type InlineNode = InlineCodeSegment | InlineTextSegment

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g

// Greedy backtick run length so ``code with `backticks` inside`` works.
const INLINE_CODE_RE = /(`+)([^`\n][\s\S]*?)\1/g

function splitFences(text: string): TopSegment[] {
  const segments: TopSegment[] = []
  let cursor = 0

  for (const match of text.matchAll(FENCE_RE)) {
    const start = match.index ?? 0

    if (start > cursor) {
      segments.push({ kind: 'inline', text: text.slice(cursor, start) })
    }

    segments.push({
      kind: 'fence',
      lang: (match[1] || '').trim() || null,
      code: match[2] ?? ''
    })
    cursor = start + match[0].length
  }

  if (cursor < text.length) {
    segments.push({ kind: 'inline', text: text.slice(cursor) })
  }

  return segments
}

function splitInlineCode(text: string): InlineNode[] {
  const nodes: InlineNode[] = []
  let cursor = 0

  for (const match of text.matchAll(INLINE_CODE_RE)) {
    const start = match.index ?? 0

    if (start > cursor) {
      nodes.push({ kind: 'inline-text', text: text.slice(cursor, start) })
    }

    nodes.push({ kind: 'inline-code', code: match[2] })
    cursor = start + match[0].length
  }

  if (cursor < text.length) {
    nodes.push({ kind: 'inline-text', text: text.slice(cursor) })
  }

  return nodes
}

interface UserMessageTextProps {
  text: string
  className?: string
}

export const UserMessageText: FC<UserMessageTextProps> = ({ className, text }) => {
  const top = useMemo(() => splitFences(text), [text])

  return (
    <span className={cn('block', className)} data-slot="aui_user-message-text">
      {top.map((segment, segmentIndex) => {
        if (segment.kind === 'fence') {
          return (
            <pre
              className="my-1.5 max-w-full overflow-x-auto rounded-md border border-border/45 bg-[color-mix(in_srgb,currentColor_5%,transparent)] px-2.5 py-2 font-mono text-[0.86em] leading-snug"
              data-slot="aui_user-fence"
              key={`fence-${segmentIndex}`}
            >
              <code className="block whitespace-pre">{segment.code}</code>
            </pre>
          )
        }

        return (
          <Fragment key={`inline-${segmentIndex}`}>
            <InlineSegmentView text={segment.text} />
          </Fragment>
        )
      })}
    </span>
  )
}

type UrlSegment = { kind: 'embed'; descriptor: EmbedDescriptor } | { kind: 'text'; text: string }

// Mirrors the "bare autolink → rich embed" check in markdown-text.tsx, minus
// the markdown AST — there's no autolinking pass here, so bare URLs are
// found directly against the raw text instead of via an already-parsed <a>
// node. Desktop only (embed renderers are webview/iframe-based), matching
// the assistant pipeline's own guard.
function splitEmbeddableUrls(text: string): UrlSegment[] {
  if (!window.hermesDesktop) {
    return [{ kind: 'text', text }]
  }

  const segments: UrlSegment[] = []
  let cursor = 0

  for (const match of text.matchAll(EXPLICIT_URL_RE)) {
    const raw = match[0]
    const start = match.index ?? 0
    const descriptor = detectEmbed(normalizeExternalUrl(raw))

    if (!descriptor) {
      continue
    }

    if (start > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, start) })
    }

    segments.push({ kind: 'embed', descriptor })
    cursor = start + raw.length
  }

  if (segments.length === 0) {
    return [{ kind: 'text', text }]
  }

  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) })
  }

  return segments
}

const InlineTextWithEmbeds: FC<{ text: string }> = ({ text }) => {
  const segments = useMemo(() => splitEmbeddableUrls(text), [text])

  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'embed' ? (
          <UrlEmbed descriptor={segment.descriptor} key={`embed-${index}-${segment.descriptor.id}`} />
        ) : (
          // DirectiveContent still resolves @file:/@url: chips in whatever's
          // left. It already preserves whitespace.
          <DirectiveContent key={`text-${index}`} text={segment.text} />
        )
      )}
    </>
  )
}

const InlineSegmentView: FC<{ text: string }> = ({ text }) => {
  const nodes = useMemo(() => splitInlineCode(text), [text])

  return (
    // styles.css bidi hook (#44150); whitespace-pre-line makes each line its own
    // UAX#9 paragraph so it resolves direction independently.
    <span className="wrap-anywhere block whitespace-pre-line" data-slot="aui_user-inline-text">
      {nodes.map((node, nodeIndex) =>
        node.kind === 'inline-code' ? (
          <code
            className="mx-px rounded bg-[color-mix(in_srgb,currentColor_8%,transparent)] px-1 py-px font-mono text-[0.92em]"
            data-slot="aui_user-inline-code"
            key={`code-${nodeIndex}`}
          >
            {node.code}
          </code>
        ) : (
          <Fragment key={`text-${nodeIndex}`}>
            <InlineTextWithEmbeds text={node.text} />
          </Fragment>
        )
      )}
    </span>
  )
}
