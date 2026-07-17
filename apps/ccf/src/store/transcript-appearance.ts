import { atom } from 'nanostores'

import { persistString, storedString } from '@/lib/storage'

export type TranscriptTextSize = 'large' | 'medium' | 'small'
export type TranscriptWidth = 'medium' | 'narrow' | 'wide'

const TEXT_SIZE_KEY = 'hermes.desktop.transcriptTextSize'
const WIDTH_KEY = 'hermes.desktop.transcriptWidth'

const TEXT_SIZES: readonly TranscriptTextSize[] = ['small', 'medium', 'large']
const WIDTHS: readonly TranscriptWidth[] = ['narrow', 'medium', 'wide']

// Pro-only settings (see composer-layout.ts): the values driving
// --conversation-text-font-size / --composer-width when Pro is active. The
// applying effect (transcript-appearance-effect.tsx) falls back to the
// stylesheet defaults whenever Casual is selected.
export const TRANSCRIPT_TEXT_SIZE_REM: Record<TranscriptTextSize, string> = {
  large: '0.9375rem',
  medium: '0.8125rem',
  small: '0.75rem'
}

export const TRANSCRIPT_WIDTH_REM: Record<TranscriptWidth, string> = {
  medium: '54rem',
  narrow: '44rem',
  wide: '76rem'
}

function readEnum<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const raw = storedString(key)

  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}

export const $transcriptTextSize = atom<TranscriptTextSize>(readEnum(TEXT_SIZE_KEY, TEXT_SIZES, 'medium'))
export const $transcriptWidth = atom<TranscriptWidth>(readEnum(WIDTH_KEY, WIDTHS, 'medium'))

$transcriptTextSize.subscribe(size => persistString(TEXT_SIZE_KEY, size))
$transcriptWidth.subscribe(width => persistString(WIDTH_KEY, width))

export function setTranscriptTextSize(size: TranscriptTextSize) {
  $transcriptTextSize.set(size)
}

export function setTranscriptWidth(width: TranscriptWidth) {
  $transcriptWidth.set(width)
}
