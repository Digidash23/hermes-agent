import { Codecs, persistentAtom } from '@/lib/persisted'

const PINNED_MESSAGE_IDS_KEY = 'hermes.desktop.pinnedMessageIds'

// Flat, global list of pinned message IDs — no per-session keying needed. A
// message's own id is already unique across every session, so the pinned-
// messages rail just filters the *current* thread's own messages against
// this set at render time (see ThreadTimeline).
export const $pinnedMessageIds = persistentAtom<string[]>(PINNED_MESSAGE_IDS_KEY, [], Codecs.stringArray)

export function isMessagePinned(messageId: string): boolean {
  return $pinnedMessageIds.get().includes(messageId)
}

export function togglePinnedMessage(messageId: string): void {
  const current = $pinnedMessageIds.get()

  $pinnedMessageIds.set(
    current.includes(messageId) ? current.filter(id => id !== messageId) : [...current, messageId]
  )
}
