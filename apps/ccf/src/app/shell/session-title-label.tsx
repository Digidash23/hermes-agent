import { useStore } from '@nanostores/react'

import { Codicon } from '@/components/ui/codicon'
import { sessionTitle } from '@/lib/chat-runtime'
import { $selectedStoredSessionId, $sessions, sessionMatchesStoredId } from '@/store/session'

// Session-title chip for the titlebar's left slot, right outside the
// sidebar. Same data source as ChatHeader's own title (chat/index.tsx),
// read independently here rather than touching that (deliberately
// untouched, tree-hidden) header component. No card/badge background —
// just an icon + the title text, matching the chat's own text color.
export function SessionTitleLabel() {
  const sessions = useStore($sessions)
  const selectedSessionId = useStore($selectedStoredSessionId)

  const activeStoredSession =
    (selectedSessionId && sessions.find(session => sessionMatchesStoredId(session, selectedSessionId))) || null

  // Nothing to show on a fresh, unstarted draft — no "New session" filler.
  if (!activeStoredSession) {
    return null
  }

  return (
    <span className="flex items-center gap-1.5">
      <Codicon className="shrink-0 text-muted-foreground/85" name="device-desktop" size="0.875rem" />
      <span className="max-w-60 truncate text-[0.8125rem] font-medium leading-none text-foreground">
        {sessionTitle(activeStoredSession)}
      </span>
    </span>
  )
}
