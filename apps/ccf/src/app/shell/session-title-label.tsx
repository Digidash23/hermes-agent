import { useStore } from '@nanostores/react'

import { Codicon } from '@/components/ui/codicon'
import { sessionTitle } from '@/lib/chat-runtime'
import { $selectedStoredSessionId, $sessions, sessionMatchesStoredId } from '@/store/session'

// Session-title chip for the top strip, same 34px band and vertical center as
// the window's traffic lights. Rendered as an absolute child of the TREE
// WRAPPER (the flex sibling right after the sidebar in ContribController),
// not the window-wide titlebar strip — that wrapper is a REAL flex sibling,
// so the browser positions it correctly after the sidebar on its own. The
// old version lived in the window-wide titlebar strip and aligned itself via
// a fixed position plus a --workspace-left CSS var published from the pane
// tree — once the sidebar became bespoke chrome living OUTSIDE the tree, that
// var no longer reliably tracked the sidebar's real width, so the label
// rendered as an overlay on top of the sidebar instead of starting after it.
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
    <span
      className="pointer-events-none absolute left-2 top-0 z-40 flex h-[34px] max-w-[calc(100%-1rem)] items-center gap-1.5"
      data-suppress-pane-reveal=""
    >
      <Codicon className="shrink-0 text-muted-foreground/85" name="device-desktop" size="0.875rem" />
      <span className="max-w-60 truncate text-[0.8125rem] font-medium leading-none text-foreground">
        {sessionTitle(activeStoredSession)}
      </span>
    </span>
  )
}
