import { useStore } from '@nanostores/react'
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef } from 'react'

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

  if (!containerEl) {
    return maxWidthForViewport()
  }

  const containerWidth = containerEl.getBoundingClientRect().width
  const sidebarWidth = $sidebarOpen.get() ? $ccfSidebarWidth.get() : 0
  const available = containerWidth - sidebarWidth - MIN_MAIN_CONTENT_WIDTH - FLEX_GAPS_PX

  return Math.min(BROWSER_WORKSTATION_MAX_WIDTH, Math.max(BROWSER_WORKSTATION_DEFAULT_WIDTH, available))
}

export function BrowserWorkstationResizeHandle({ side }: { side: 'left' | 'right' }) {
  const width = useStore($browserWorkstationWidth)
  const dragStart = useRef<null | { pointerX: number; width: number }>(null)
  const handleRef = useRef<HTMLDivElement>(null)

  // Safety net, not just a prediction: measuredMaxWidth's estimate of how much
  // room the main content zone needs can still be wrong (it's a floor we
  // don't directly control — see the comment above measuredMaxWidth). This
  // runs after every actual render and checks the REAL rendered geometry; if
  // the panel overflowed anyway, it corrects by exactly the measured overflow
  // instead of the guess ever leaving a persistent gap.
  useEffect(() => {
    const wrapperEl = handleRef.current?.parentElement
    const containerEl = wrapperEl?.parentElement

    if (!wrapperEl || !containerEl) {
      return
    }

    const overflow = wrapperEl.getBoundingClientRect().right - containerEl.getBoundingClientRect().right

    if (overflow > 0.5) {
      $browserWorkstationWidth.set(Math.max(BROWSER_WORKSTATION_DEFAULT_WIDTH, width - overflow))
    }
  }, [width])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      dragStart.current = { pointerX: event.clientX, width: $browserWorkstationWidth.get() }
      event.currentTarget.setPointerCapture(event.pointerId)

      const handleEl = event.currentTarget

      const onMove = (moveEvent: PointerEvent) => {
        if (!dragStart.current) {
          return
        }

        const delta = moveEvent.clientX - dragStart.current.pointerX
        const next = side === 'right' ? dragStart.current.width + delta : dragStart.current.width - delta
        const max = measuredMaxWidth(handleEl)
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
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [side]
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
}
