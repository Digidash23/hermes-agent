import { ActionBarPrimitive, BranchPickerPrimitive, MessagePrimitive, useAuiState } from '@assistant-ui/react'
import { type FC, type ReactNode } from 'react'

import { DirectiveContent, formatRefValue } from '@/components/assistant-ui/directive-text'
import {
  extractPersistedImageHints,
  messageAttachmentRefs,
  messageContentText
} from '@/components/assistant-ui/thread/content'
import { UserMessageText } from '@/components/assistant-ui/thread/user-message-text'
import { Codicon } from '@/components/ui/codicon'
import { CopyButton } from '@/components/ui/copy-button'
import { useI18n } from '@/i18n'
import { StopFilled } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { isWatchWindow } from '@/store/windows'

export function HumanMessageRow({
  attachments,
  children,
  messageId
}: {
  attachments?: ReactNode
  children: ReactNode
  messageId?: string
}) {
  return (
    // CSS Grid, not Flexbox, for the right-aligned bubble column — mirrors
    // assistant-ui's own reference UserMessage (grid-cols-[minmax(_,1fr)_auto]).
    // A `width: fit-content` FLEX item with `overflow: hidden` hits a real
    // Chromium bug where its computed width collapses below its own content's
    // natural width — confirmed live via DevTools; short messages like "hey"
    // rendered as three separate lines even with plenty of room. The first
    // column absorbs the empty space and pushes the bubble right;
    // `[&>*]:col-start-2` puts every direct child (the bubble, the checkpoint
    // nav below it) in the second, content-sized column.
    //
    // minmax(25%,1fr): the 25% is the actual cap — it forces the empty first
    // column to reserve at least a quarter of the row, which caps the
    // bubble's column at 75% (AWM's own bubble max-width, and standard chat-UI
    // practice generally). This percentage is safe where one on the bubble
    // itself isn't: the first column holds no content, so there's no item
    // whose own size the percentage could circularly depend on.
    //
    // IMPORTANT: don't add a max-width to the bubble itself (see
    // USER_BUBBLE_BASE_CLASS) — a percentage max-width on an item inside an
    // auto-sized grid track recreates the same collapse via a different
    // mechanism (the item's max-width resolves against its own containing
    // block, which is sized *by* the item — circular). The column split
    // above is the only cap the bubble needs.
    <>
      {attachments}
      <div
        className="group/user-message grid w-full grid-cols-[minmax(25%,1fr)_auto] gap-0 px-4 pb-(--conversation-turn-gap) pt-1 [&>*]:col-start-2"
        data-message-id={messageId}
        data-role="user"
        data-slot="aui_user-message-root"
      >
        {children}
      </div>
    </>
  )
}

// A plain, non-editable, non-clamped bubble — matches AWM's chat bubble
// (packages/desktop/src/styles.css .msg.user .bubble) exactly: no border,
// 12px radius, 11px/16px padding. Literal px values, not Tailwind's
// rem-scaled equivalents, so they hold regardless of the root font-size.
//
// No max-width here on purpose (see HumanMessageRow's comment) — the grid
// row's own column split is what caps how wide this can get; a max-width
// added here as an "extra" safety net re-introduces a circular sizing
// collapse instead of adding one.
export const USER_BUBBLE_BASE_CLASS =
  'composer-human-message standalone-glass relative rounded-[12px] bg-(--dt-user-bubble) px-[16px] py-[11px] text-left [-webkit-app-region:no-drag]'

export const USER_ACTION_ICON_BUTTON_CLASS =
  'grid place-items-center rounded-md bg-transparent text-(--ui-text-secondary) transition-colors hover:bg-(--ui-control-active-background) hover:text-foreground disabled:cursor-default disabled:text-(--ui-text-quaternary) disabled:opacity-70'

export const USER_ACTION_ICON_SIZE = '0.6875rem'
export const StopGlyph = <StopFilled aria-hidden className="size-3.5 -translate-y-px" />

// Background-process notifications are injected into the conversation as user
// messages (the agent must react to them, and message-role alternation forbids
// a synthetic system row mid-loop). They are NOT something the human typed, so
// render them as a compact system-style notice instead of a user bubble.
// Shape: see tools/process_registry.py format_process_notification().
const PROCESS_NOTIFICATION_RE = /^\[IMPORTANT: Background process [\s\S]*\]$/

const ProcessNotificationNote: FC<{ text: string }> = ({ text }) => {
  const body = text.replace(/^\[IMPORTANT:\s*/, '').replace(/\]$/, '')
  const newline = body.indexOf('\n')
  const headline = (newline === -1 ? body : body.slice(0, newline)).trim()
  const detail = newline === -1 ? '' : body.slice(newline + 1).trim()

  return (
    <div className="flex max-w-[min(86%,44rem)] flex-col gap-0.5 self-center px-2 py-0.5 text-[0.6875rem] leading-5 text-muted-foreground/60">
      <span className="flex items-center gap-1.5">
        <Codicon className="shrink-0 text-muted-foreground/55" name="terminal" size="0.75rem" />
        <span className="wrap-anywhere">{headline}</span>
      </span>
      {detail && (
        <details className="pl-[1.3125rem]">
          <summary className="cursor-pointer select-none text-muted-foreground/45 hover:text-muted-foreground/70">
            output
          </summary>
          <pre
            className="mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[0.625rem] leading-4 text-muted-foreground/55"
            data-selectable-text="true"
          >
            {detail}
          </pre>
        </details>
      )}
    </div>
  )
}

// Standard chat-UI pattern: a small copy row under the bubble, revealed on
// hover, right-aligned to match the right-aligned bubble above it (mirrors
// AssistantActionBar's left-aligned equivalent — same data-slot styling hook
// in styles.css, so the two render pixel-identical).
const UserActionBar: FC<{ getMessageText: () => string }> = ({ getMessageText }) => {
  const { t } = useI18n()
  const copy = t.assistant.thread

  return (
    <div className="relative flex w-full shrink-0 justify-end">
      <ActionBarPrimitive.Root
        className="relative flex flex-row items-center justify-end gap-2 py-1.5 opacity-0 pointer-events-none group-hover/user-message:pointer-events-auto group-hover/user-message:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"
        data-slot="aui_user-msg-actions"
      >
        <CopyButton appearance="icon" buttonSize="icon" label={copy.copy} text={getMessageText} />
      </ActionBarPrimitive.Root>
    </div>
  )
}

export const UserMessage: FC = () => {
  const { t } = useI18n()
  const copy = t.assistant.thread
  const messageId = useAuiState(s => s.message.id)
  const content = useAuiState(s => s.message.content)
  const rawMessageText = messageContentText(content)

  const liveAttachmentRefs = useAuiState(s => {
    const custom = (s.message.metadata?.custom ?? {}) as { attachmentRefs?: unknown }

    return messageAttachmentRefs(custom.attachmentRefs)
  })

  // liveAttachmentRefs only ever exists in memory for the session that sent
  // the message (submit.ts) — a reload has none. Fall back to the backend's
  // persisted hint-line text instead of showing it raw (see
  // extractPersistedImageHints for why the backend doesn't just persist the
  // image bytes).
  const persistedHints = liveAttachmentRefs.length === 0 ? extractPersistedImageHints(rawMessageText) : null
  const messageText = persistedHints ? persistedHints.cleanedText : rawMessageText

  const attachmentRefs =
    liveAttachmentRefs.length > 0
      ? liveAttachmentRefs
      : (persistedHints?.paths ?? []).map(path => `@image:${formatRefValue(path)}`)

  // Watch windows spectate a subagent run driven elsewhere — prompts can't be
  // edited or restored from here, so the checkpoint nav is hidden; the bubble
  // itself renders the same either way.
  const readOnly = isWatchWindow()

  // Injected background-process notification, not a human prompt — render the
  // compact system-style notice (after all hooks above have run).
  if (PROCESS_NOTIFICATION_RE.test(messageText.trim())) {
    return (
      <MessagePrimitive.Root
        className="flex w-full min-w-0 flex-col items-stretch"
        data-role="user"
        data-slot="aui_user-message-root"
      >
        <ProcessNotificationNote text={messageText.trim()} />
      </MessagePrimitive.Root>
    )
  }

  const hasBody = messageText.trim().length > 0

  const bubbleContent = hasBody && (
    // Render the user's text through a minimal markdown pipeline: backtick
    // `code` and ``` fenced ``` blocks, with directive chips (`@file:` etc.)
    // still resolved inside the plain-text spans.
    <UserMessageText className="wrap-anywhere" text={messageText} />
  )

  return (
    <MessagePrimitive.Root asChild>
      <HumanMessageRow
        attachments={
          // Attachments render above the bubble, in normal flow — putting the
          // text first left a gap before the image (the hover-only copy
          // button row between them still reserves its height). Image refs
          // render as thumbnails, file refs as chips; no border.
          attachmentRefs.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-1 mb-[2px] px-4">
              <DirectiveContent text={attachmentRefs.join(' ')} />
            </div>
          ) : null
        }
        messageId={messageId}
      >
        {hasBody && (
          <div className="relative">
            <div
              className={cn(
                USER_BUBBLE_BASE_CLASS,
                'text-[length:var(--conversation-text-font-size)] leading-(--dt-line-height) text-foreground/95'
              )}
            >
              {bubbleContent}
            </div>
          </div>
        )}
        {hasBody && <UserActionBar getMessageText={() => messageText} />}
        <BranchPickerPrimitive.Root
          className={cn(
            'checkpoint-container flex items-center gap-1 pb-0 pt-1 pl-1.5 text-[0.75rem] leading-none text-(--ui-text-tertiary)',
            readOnly && 'hidden'
          )}
          hideWhenSingleBranch
        >
          <span aria-hidden className="checkpoint-icon size-1.5 rounded-full border border-current" />
          <BranchPickerPrimitive.Previous
            className="checkpoint-restore-text rounded-sm bg-transparent px-1 opacity-65 hover:opacity-100 disabled:hidden disabled:cursor-default"
            title={copy.restorePrevious}
          >
            {copy.restoreCheckpoint}
          </BranchPickerPrimitive.Previous>
          <span className="checkpoint-divider opacity-55">
            <BranchPickerPrimitive.Number />/<BranchPickerPrimitive.Count />
          </span>
          <BranchPickerPrimitive.Next
            className="checkpoint-restore-text rounded-sm bg-transparent px-1 opacity-65 hover:opacity-100 disabled:hidden disabled:cursor-default"
            title={copy.restoreNext}
          >
            {copy.goForward}
          </BranchPickerPrimitive.Next>
        </BranchPickerPrimitive.Root>
      </HumanMessageRow>
    </MessagePrimitive.Root>
  )
}
