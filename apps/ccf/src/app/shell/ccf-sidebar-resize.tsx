import { useStore } from '@nanostores/react'
import { type PointerEvent as ReactPointerEvent, useCallback, useRef } from 'react'

import { type Codec, persistentAtom } from '@/lib/persisted'
import { cn } from '@/lib/utils'
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH } from '@/store/layout'

// The sidebar is bespoke CCF chrome now, outside the pane tree (see
// contrib/controller.tsx) — it lost drag-to-resize when it left the tree's
// generic sash system, so this is a small standalone equivalent: one
// persisted width, one drag handle, clamped to the same
// [SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH] range the tree pane used to
// enforce.
const numberCodec: Codec<number> = {
  decode: raw => Number(raw),
  encode: value => String(value)
}

export const $ccfSidebarWidth = persistentAtom('ccf.sidebarWidth', SIDEBAR_DEFAULT_WIDTH, numberCodec)

const clampWidth = (width: number) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_DEFAULT_WIDTH, width))

export function useCcfSidebarWidth(): number {
  // Re-clamp on read: a persisted width from before SIDEBAR_MAX_WIDTH last
  // changed could still be sitting outside the current range.
  return clampWidth(useStore($ccfSidebarWidth))
}

export function CcfSidebarResizeHandle({ side }: { side: 'left' | 'right' }) {
  // Captured at drag start so a fast drag's intermediate pointermoves compute
  // off a stable origin, not the previous frame's (already-updated) width.
  const dragStart = useRef<null | { pointerX: number; width: number }>(null)

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      dragStart.current = { pointerX: event.clientX, width: $ccfSidebarWidth.get() }
      event.currentTarget.setPointerCapture(event.pointerId)

      const onMove = (moveEvent: PointerEvent) => {
        if (!dragStart.current) {
          return
        }

        const delta = moveEvent.clientX - dragStart.current.pointerX
        const next = side === 'right' ? dragStart.current.width + delta : dragStart.current.width - delta

        $ccfSidebarWidth.set(clampWidth(next))
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
      aria-label="Resize sidebar"
      className={cn(
        'group absolute inset-y-0 z-20 w-[15px] cursor-col-resize [-webkit-app-region:no-drag]',
        side === 'right' ? '-right-2' : '-left-2'
      )}
      // Double-click resets to default width — same affordance the tree's
      // sash offers via its own reset gesture.
      onDoubleClick={() => $ccfSidebarWidth.set(SIDEBAR_DEFAULT_WIDTH)}
      onPointerDown={onPointerDown}
      role="separator"
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-(--ui-sash-hover-border)" />
    </div>
  )
}
