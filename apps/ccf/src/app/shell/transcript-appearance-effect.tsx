import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { $composerLayoutStyle } from '@/store/composer-layout'
import {
  $transcriptTextSize,
  $transcriptWidth,
  TRANSCRIPT_TEXT_SIZE_REM,
  TRANSCRIPT_WIDTH_REM
} from '@/store/transcript-appearance'

// Transcript text size / width are Pro-only (see appearance-settings.tsx) —
// applied as root CSS var overrides only while Pro is active, so switching
// back to Casual reverts to the stylesheet defaults instead of leaving a
// stale override with no visible control to change it back.
export function TranscriptAppearanceEffect() {
  const layoutStyle = useStore($composerLayoutStyle)
  const textSize = useStore($transcriptTextSize)
  const width = useStore($transcriptWidth)

  useEffect(() => {
    const root = document.documentElement.style

    if (layoutStyle !== 'split') {
      root.removeProperty('--conversation-text-font-size')
      root.removeProperty('--composer-width')

      return
    }

    root.setProperty('--conversation-text-font-size', TRANSCRIPT_TEXT_SIZE_REM[textSize])
    root.setProperty('--composer-width', TRANSCRIPT_WIDTH_REM[width])

    return () => {
      root.removeProperty('--conversation-text-font-size')
      root.removeProperty('--composer-width')
    }
  }, [layoutStyle, textSize, width])

  return null
}
