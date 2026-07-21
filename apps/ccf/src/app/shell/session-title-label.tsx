import { useStore } from '@nanostores/react'

import { Codicon } from '@/components/ui/codicon'
import { sessionTitle } from '@/lib/chat-runtime'
import { $sidebarOpen } from '@/store/layout'
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
//
// left-2 only works while the sidebar is open, when the wrapper's own left
// edge already starts after the sidebar (so left-2 is relative to that).
// Closing the sidebar collapses it to zero width, so the wrapper's left edge
// becomes the WINDOW's left edge — left-2 then sits directly under the
// traffic lights and the sidebar toggle button. In that state the inset
// needs to clear those two, in the same window-relative terms the toggle
// button's own --titlebar-controls-left/--titlebar-control-size vars use
// (see shell/titlebar-controls.tsx) — those vars ARE window-relative, which
// is exactly correct here since the wrapper's own offset is 0 in this state.
export function SessionTitleLabel() {
  const sessions = useStore($sessions)
  const selectedSessionId = useStore($selectedStoredSessionId)
  const sidebarOpen = useStore($sidebarOpen)

  const activeStoredSession =
    (selectedSessionId && sessions.find(session => sessionMatchesStoredId(session, selectedSessionId))) || null

  // Nothing to show on a fresh, unstarted draft — no "New session" filler.
  if (!activeStoredSession) {
    return null
  }

  return (
    <span
      className="pointer-events-none absolute top-0 z-40 flex h-[34px] max-w-[calc(100%-1rem)] items-center gap-1.5"
      data-suppress-pane-reveal=""
      style={{
        left: sidebarOpen
          ? '0.5rem'
          : 'calc(var(--titlebar-controls-left, 14px) + 2 * var(--titlebar-control-size, 1.25rem) + 0.375rem)'
      }}
    >
      <Codicon className="shrink-0 text-muted-foreground/85" name="device-desktop" size="0.875rem" />
      <span className="max-w-60 truncate text-[0.8125rem] font-medium leading-[1.3] text-foreground">
        {sessionTitle(activeStoredSession)}
      </span>
    </span>
  )
}
