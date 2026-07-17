import { atom } from 'nanostores'

import { persistBoolean, storedBoolean } from '@/lib/storage'

export type ComposerLayoutStyle = 'split' | 'unified'

const COMPOSER_LAYOUT_UNIFIED_KEY = 'hermes.desktop.composerLayout.unified'

// 'split' (default): the approval-mode pill sits in its own row below the
// input's bordered card. 'unified': it moves inside the card, next to the
// attach ("+") button, alongside the input row.
export const $composerLayoutStyle = atom<ComposerLayoutStyle>(
  storedBoolean(COMPOSER_LAYOUT_UNIFIED_KEY, false) ? 'unified' : 'split'
)

$composerLayoutStyle.subscribe(style => persistBoolean(COMPOSER_LAYOUT_UNIFIED_KEY, style === 'unified'))

export function setComposerLayoutStyle(style: ComposerLayoutStyle) {
  $composerLayoutStyle.set(style)
}
