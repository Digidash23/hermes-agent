import type * as React from 'react'

import { Codicon } from '@/components/ui/codicon'
import { RowButton } from '@/components/ui/row-button'
import { cn } from '@/lib/utils'

// Shared, content-agnostic sidebar chrome — used by both the flat session
// sections and the project/workspace tree, so it lives outside either to keep
// imports one-directional (no index <-> projects cycle).

/** `loaded/total` when there's more on the server, else just the loaded count. */
export const countLabel = (loaded: number, total: number): string =>
  total > loaded ? `${loaded}/${total}` : String(loaded)

/** The muted count chip next to a section/workspace label. */
export function SidebarCount({ children }: { children: React.ReactNode }) {
  return <span className="text-[0.6875rem] font-medium text-(--ui-text-quaternary)">{children}</span>
}

// ── Row geometry (session row is canonical — everything composes these) ─────
//
// Height lives ONLY on SidebarRowShell (min-h-[1.625rem]). Inset children
// stretch to fill the cell and center content internally — never items-center
// on the shell grid, or short clusters (projects) float 1–2px off sessions.

const rowMinH = 'min-h-[1.625rem]'
const rowPadX = 'pl-1 pr-1'
const rowGap = 'gap-1.5'
const rowLead = 'grid size-3.5 shrink-0 place-items-center'
// flex-1: SidebarRowShell switched from grid to flex (actions is an overlay
// now, not a reserved column), so this needs to claim the row's full width
// explicitly instead of inheriting it from a minmax(0,1fr) grid track.
const rowInset = cn(rowPadX, rowGap, 'flex h-full min-w-0 flex-1 items-center self-stretch py-0.5')

// Fade instead of an ellipsis: overflow clips normally, but a mask gradient
// over the LAST 24px (fixed pixels, not a % of width) fades any clipped text
// to transparent. Short titles that never reach that zone render untouched —
// the mask only affects glyphs that are actually there.
const rowLabel =
  'min-w-0 overflow-hidden whitespace-nowrap text-[0.8125rem] leading-none text-(--ui-text-secondary) [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent_100%)] [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent_100%)]'

/** Codicon size in sidebar row leads — matches the file tree (`tree.tsx`). */
export const SIDEBAR_LEAD_ICON_SIZE = '0.875rem' as const

/** Vertical stack of rows (gap-px, single column). */
export function SidebarRowStack({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('grid grid-cols-[minmax(0,1fr)] gap-px', className)} {...props} />
}

/** Nested rows (session previews, worktree bodies). */
export function SidebarRowNest({ className, ...props }: React.ComponentProps<'div'>) {
  return <SidebarRowStack className={cn('pb-1 pl-4', className)} {...props} />
}

/** Outer row container — sole owner of row height. `actions` no longer
 *  reserves a permanent grid column (that cost every row ~22px of always-
 *  empty space to its right, even when nothing was hovering) — it's an
 *  absolutely-positioned overlay instead, hidden until hover/focus/an open
 *  menu. No backdrop of its own: it relies on the row's OWN native :hover
 *  background (the `row-hover` utility / --ui-row-hover-background, applied
 *  by each row type to its own root) already covering the full row width,
 *  text included, so the overlay just needs to appear on top of that. */
export function SidebarRowShell({
  actions,
  children,
  className,
  ...props
}: React.ComponentProps<'div'> & { actions?: React.ReactNode }) {
  return (
    <div className={cn(rowMinH, 'relative flex items-stretch rounded-[8px]', className)} {...props}>
      {children}
      {actions ? (
        <div className="pointer-events-none absolute inset-y-0 right-1 z-2 flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [&:has([data-state=open])]:opacity-100">
          <div className="pointer-events-auto flex items-center">{actions}</div>
        </div>
      ) : null}
    </div>
  )
}

/** Multi-control left cluster (project rows). */
export function SidebarRowCluster({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn(rowInset, className)} {...props} />
}

/** Session row main tap target. */
export function SidebarRowBody({ className, ...props }: React.ComponentProps<'button'>) {
  return <RowButton className={cn(rowInset, 'bg-transparent text-left', className)} {...props} />
}

/** Tappable label — underline/truncate live on the inner span, not the button. */
export function SidebarRowLink({
  className,
  labelClassName,
  children,
  ...props
}: React.ComponentProps<'button'> & { labelClassName?: string }) {
  return (
    <RowButton className={cn('min-w-0 shrink bg-transparent p-0 text-left', className)} {...props}>
      <span className={cn(rowLabel, labelClassName)}>{children}</span>
    </RowButton>
  )
}

/** Fixed leading column (dot, icon, drag handle). */
export function SidebarRowLead({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn(rowLead, className)} {...props} />
}

/** Standard row label typography. */
export function SidebarRowLabel({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn(rowLabel, className)} {...props} />
}

/** Dot ↔ grabber swap for dnd-kit reorder rows. */
export function SidebarRowGrab({
  ariaLabel,
  children,
  className,
  dragging = false,
  dragHandleProps,
  leadClassName
}: {
  ariaLabel: string
  children: React.ReactNode
  className?: string
  dragging?: boolean
  dragHandleProps?: React.HTMLAttributes<HTMLElement>
  leadClassName?: string
}) {
  return (
    <SidebarRowLead
      {...dragHandleProps}
      aria-label={ariaLabel}
      className={cn(
        'group/handle relative cursor-grab touch-none overflow-hidden active:cursor-grabbing',
        leadClassName,
        className
      )}
      data-reorder-handle
      onClick={event => event.stopPropagation()}
    >
      <span className="grid size-full place-items-center transition-opacity group-hover/handle:opacity-0 group-focus-within/handle:opacity-0">
        {children}
      </span>
      <Codicon
        className={cn(
          'absolute text-(--ui-text-quaternary) opacity-0 transition-opacity group-hover/handle:opacity-80 group-focus-within/handle:opacity-80 hover:text-(--ui-text-secondary)',
          dragging && 'text-(--ui-text-secondary) opacity-100'
        )}
        name="grabber"
        size="0.75rem"
      />
    </SidebarRowLead>
  )
}

/** Icon/dot slot inside SidebarRowLead — caps visual size so rows align. */
export function SidebarRowLeadGlyph({
  children,
  className,
  style
}: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span
      className={cn('grid size-full place-items-center text-(--ui-text-tertiary) [&_.codicon]:leading-none', className)}
      style={style}
    >
      {children}
    </span>
  )
}
