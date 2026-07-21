import { useStore } from '@nanostores/react'
import { type PointerEvent as ReactPointerEvent, useCallback, useRef } from 'react'

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
// Outer app shell padding (p-2 = 16px, both sides) + the two flex gaps
// (gap-2 = 8px each) between sidebar / main / browser panel.
const CHROME_GAP_ALLOWANCE = 48

export const $browserWorkstationWidth = persistentAtom(
  'ccf.browserWorkstationWidth',
  BROWSER_WORKSTATION_DEFAULT_WIDTH,
  numberCodec
)

// Dynamic, not just the fixed BROWSER_WORKSTATION_MAX_WIDTH — a wide window
// can afford the full 1800px, a narrower one can't, and dragging past what's
// actually left pushes the sidebar/main content off the window entirely.
function maxWidthForViewport(): number {
  if (typeof window === 'undefined') {
    return BROWSER_WORKSTATION_MAX_WIDTH
  }

  const sidebarWidth = $sidebarOpen.get() ? $ccfSidebarWidth.get() : 0
  const available = window.innerWidth - sidebarWidth - MIN_MAIN_CONTENT_WIDTH - CHROME_GAP_ALLOWANCE

  return Math.min(BROWSER_WORKSTATION_MAX_WIDTH, Math.max(BROWSER_WORKSTATION_DEFAULT_WIDTH, available))
}

const clampWidth = (width: number) => {
  const max = maxWidthForViewport()

  return Math.min(max, Math.max(BROWSER_WORKSTATION_DEFAULT_WIDTH, width))
}

export function useBrowserWorkstationWidth(): number {
  return clampWidth(useStore($browserWorkstationWidth))
}

export function BrowserWorkstationResizeHandle({ side }: { side: 'left' | 'right' }) {
  const dragStart = useRef<null | { pointerX: number; width: number }>(null)

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      dragStart.current = { pointerX: event.clientX, width: $browserWorkstationWidth.get() }
      event.currentTarget.setPointerCapture(event.pointerId)

      const onMove = (moveEvent: PointerEvent) => {
        if (!dragStart.current) {
          return
        }

        const delta = moveEvent.clientX - dragStart.current.pointerX
        const next = side === 'right' ? dragStart.current.width + delta : dragStart.current.width - delta
        const clamped = clampWidth(next)

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
      role="separator"
    >
      <span className="absolute left-1/2 top-1/2 h-14 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent transition-colors group-hover:bg-(--ui-sash-hover-border)" />
    </div>
  )
}
