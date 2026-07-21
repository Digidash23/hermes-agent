import { useStore } from '@nanostores/react'
import { memo, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef } from 'react'

import { type Codec, persistentAtom } from '@/lib/persisted'
import { cn } from '@/lib/utils'
import { $sidebarOpen } from '@/store/layout'

import { $ccfSidebarWidth } from './ccf-sidebar-resize'

// Same standalone drag-resize as CcfSidebarResizeHandle (see
// ccf-sidebar-resize.tsx) — the browser panel lives outside the pane tree too,
// so it needs its own persisted width + handle rather than the tree's sash.
const numberCodec: Codec<number> = {
  decode: raw => Number(raw),
  encode: value => String(value)
}

export const BROWSER_WORKSTATION_DEFAULT_WIDTH = 420
export const BROWSER_WORKSTATION_MAX_WIDTH = 1800

// The chat/tree zone in the middle can't shrink to zero — it needs to stay
// usable. Below this, the browser panel stops growing even if its own max
// would otherwise allow it, so it can never shove the main content off-window.
const MIN_MAIN_CONTENT_WIDTH = 480
// The two flex gaps (gap-2 = 8px each) between sidebar / main / browser panel.
// NOT the outer shell's own padding — window.innerWidth already excludes
// nothing, but a measured container rect already excludes the shell's own
// padding on its own, so this constant must only cover what a container
// measurement wouldn't already have subtracted.
const FLEX_GAPS_PX = 16

export const $browserWorkstationWidth = persistentAtom(
  'ccf.browserWorkstationWidth',
  BROWSER_WORKSTATION_DEFAULT_WIDTH,
  numberCodec
)

// Fallback for contexts with no live container to measure (e.g. the initial
// render before any drag has happened). window.innerWidth here needs the
// shell's own p-2 (8px each side = 16px) subtracted too, since — unlike a
// measured container rect — it doesn't already exclude that padding.
function maxWidthForViewport(): number {
  if (typeof window === 'undefined') {
    return BROWSER_WORKSTATION_MAX_WIDTH
  }

  const sidebarWidth = $sidebarOpen.get() ? $ccfSidebarWidth.get() : 0
  const shellPaddingPx = 16
  const available = window.innerWidth - sidebarWidth - MIN_MAIN_CONTENT_WIDTH - FLEX_GAPS_PX - shellPaddingPx

  return Math.min(BROWSER_WORKSTATION_MAX_WIDTH, Math.max(BROWSER_WORKSTATION_DEFAULT_WIDTH, available))
}

const clampWidth = (width: number) => {
  const max = maxWidthForViewport()

  return Math.min(max, Math.max(BROWSER_WORKSTATION_DEFAULT_WIDTH, width))
}

export function useBrowserWorkstationWidth(): number {
  return clampWidth(useStore($browserWorkstationWidth))
}

// The main content wrapper is the only sibling with no inline width — the
// sidebar and this panel both set style.width explicitly (see controller.tsx);
// the main content is sized by flex-1 instead. That's a reliable way to pick
// it out without depending on sibling order (sidebar can be first or absent).
function findMainContentEl(containerEl: Element, wrapperEl: Element): Element | null {
  return (
    Array.from(containerEl.children).find(
      (child): child is HTMLElement => child instanceof HTMLElement && child !== wrapperEl && !child.style.width
    ) ?? null
  )
}

// Real, not guessed: the pane-tree enforces the chat area's true floor a few
// levels down as an actual CSS min-width (currently 22vw, resolved to px) —
// see components/pane-shell. Reading it directly, instead of assuming
// MIN_MAIN_CONTENT_WIDTH, means the live drag stops exactly at the true
// limit instead of overshooting it and needing the post-release correction
// to visibly snap it back.
function findRealMinContentWidth(mainContentEl: Element): number {
  const stack: Element[] = [mainContentEl]

  while (stack.length > 0) {
    const el = stack.pop()

    if (!el) {
      continue
    }

    const minWidth = Number.parseFloat(getComputedStyle(el).minWidth)

    if (Number.isFinite(minWidth) && minWidth > 0) {
      return minWidth
    }

    stack.push(...Array.from(el.children))
  }

  return MIN_MAIN_CONTENT_WIDTH
}

// Live-measured ceiling for an in-progress drag. The bug this replaces:
// maxWidthForViewport() used window.innerWidth as its base, but the flex row
// this panel lives in is inset by the shell's own p-2 — so its real right
// edge sits 8px inside window.innerWidth. That 8px gap is exactly what was
// disappearing ("the panel pushes past the edge, fills the gap"). Measuring
// the container's actual rect sidesteps the whole estimate — it already
// reflects the shell's real padding, no guessing required.
function measuredMaxWidth(handleEl: HTMLElement): number {
  const wrapperEl = handleEl.parentElement
  const containerEl = wrapperEl?.parentElement

  if (!wrapperEl || !containerEl) {
    return maxWidthForViewport()
  }

  const containerWidth = containerEl.getBoundingClientRect().width
  const sidebarWidth = $sidebarOpen.get() ? $ccfSidebarWidth.get() : 0
  const mainContentEl = findMainContentEl(containerEl, wrapperEl)
  const minMainContentWidth = mainContentEl ? findRealMinContentWidth(mainContentEl) : MIN_MAIN_CONTENT_WIDTH
  const available = containerWidth - sidebarWidth - minMainContentWidth - FLEX_GAPS_PX

  return Math.min(BROWSER_WORKSTATION_MAX_WIDTH, Math.max(BROWSER_WORKSTATION_DEFAULT_WIDTH, available))
}

// Memoized so it doesn't re-render just because its parent (the width-driven
// wrapper) does — side is the only prop and it's a stable string literal, so
// this effectively only re-renders for its own internal state changes.
export const BrowserWorkstationResizeHandle = memo(function BrowserWorkstationResizeHandle({
  side
}: {
  side: 'left' | 'right'
}) {
  const width = useStore($browserWorkstationWidth)
  // The overflow check below only fires when something it's watching changes.
  // It needs to watch the sidebar too, not just its own width — opening the
  // sidebar shrinks the same shared row exactly the way dragging this panel
  // wider does, so it's the same overflow risk, not a separate case.
  const sidebarOpen = useStore($sidebarOpen)
  const sidebarWidth = useStore($ccfSidebarWidth)
  const dragStart = useRef<null | { pointerX: number; width: number }>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)

  const correctOverflow = useCallback(() => {
    const wrapperEl = handleRef.current?.parentElement
    const containerEl = wrapperEl?.parentElement

    if (!wrapperEl || !containerEl) {
      return
    }

    const overflow = wrapperEl.getBoundingClientRect().right - containerEl.getBoundingClientRect().right

    if (overflow > 0.5) {
      $browserWorkstationWidth.set(Math.max(BROWSER_WORKSTATION_DEFAULT_WIDTH, $browserWorkstationWidth.get() - overflow))
    }
  }, [])

  // Safety net, not just a prediction: measuredMaxWidth's estimate of how much
  // room the main content zone needs can still be wrong (it's a floor we
  // don't directly control — see the comment above measuredMaxWidth). This
  // checks the REAL rendered geometry after a width change and corrects any
  // overflow by exactly the measured amount. Stands down while an active drag
  // is in progress: onMove's own live-measured clamp is already authoritative
  // there, and this effect firing on the SAME render would fight it pixel by
  // pixel on every single pointermove — visible as the panel jittering/
  // shaking while dragging instead of moving smoothly.
  useEffect(() => {
    if (isDraggingRef.current) {
      return
    }

    correctOverflow()
  }, [width, sidebarOpen, sidebarWidth, correctOverflow])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      isDraggingRef.current = true
      dragStart.current = { pointerX: event.clientX, width: $browserWorkstationWidth.get() }
      event.currentTarget.setPointerCapture(event.pointerId)

      // Measured once, here, not inside onMove: the constraint (the chat
      // area's real min-width, the sidebar's width) can't change mid-drag,
      // only the window resizing could move it, which isn't happening while
      // you're dragging. Re-walking the DOM and forcing a layout read on
      // every single pointermove — which can fire 100+ times/sec — was the
      // actual cause of the dragging feeling janky/not smooth.
      const max = measuredMaxWidth(event.currentTarget)

      const onMove = (moveEvent: PointerEvent) => {
        if (!dragStart.current) {
          return
        }

        const delta = moveEvent.clientX - dragStart.current.pointerX
        const next = side === 'right' ? dragStart.current.width + delta : dragStart.current.width - delta
        const clamped = Math.min(max, Math.max(BROWSER_WORKSTATION_DEFAULT_WIDTH, next))

        $browserWorkstationWidth.set(clamped)

        // Re-anchor the moment the clamp actually engages. Without this the
        // pointer keeps banking distance past the ceiling/floor while
        // dragStart stays put, so reversing direction does nothing until the
        // mouse works off that banked distance — it LOOKS like the panel is
        // still being pushed even though the stored width is already capped.
        if (clamped !== next) {
          dragStart.current = { pointerX: moveEvent.clientX, width: clamped }
        }
      }

      const onUp = () => {
        dragStart.current = null
        isDraggingRef.current = false
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        // The drag's own clamp is a prediction; run the real-geometry check
        // once more now that dragging has stopped and stopped suppressing it.
        // Deferred a frame so this reads post-render layout, not whatever was
        // on screen the instant before the last width update painted.
        requestAnimationFrame(correctOverflow)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [side, correctOverflow]
  )

  return (
    <div
      aria-label="Resize browser panel"
      className={cn(
        'group absolute inset-y-0 z-20 w-[15px] cursor-col-resize [-webkit-app-region:no-drag]',
        side === 'right' ? '-right-2' : '-left-2'
      )}
      onDoubleClick={() => $browserWorkstationWidth.set(BROWSER_WORKSTATION_DEFAULT_WIDTH)}
      onPointerDown={onPointerDown}
      ref={handleRef}
      role="separator"
    >
      <span className="absolute left-1/2 top-1/2 h-14 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent transition-colors group-hover:bg-(--ui-sash-hover-border)" />
    </div>
  )
})
