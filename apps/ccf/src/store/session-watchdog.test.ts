import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  $stalledSessionIds,
  $workingSessionIds,
  noteSessionActivity,
  setSessionWorking,
  setStalledSessionIds,
  setWorkingSessionIds
} from './session'

const WATCHDOG_MS = 8 * 60 * 1000

describe('session watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setWorkingSessionIds(() => [])
    setStalledSessionIds(() => [])
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('marks a silent session stalled without pretending it finished', () => {
    setSessionWorking('s1', true)
    expect($workingSessionIds.get()).toContain('s1')

    vi.advanceTimersByTime(WATCHDOG_MS)

    // Silence is a presentation hint, not completion — the working flag
    // (and everything downstream that reads it, e.g. the composer) must
    // never be force-cleared by a client-side timeout guess.
    expect($workingSessionIds.get()).toContain('s1')
    expect($stalledSessionIds.get()).toContain('s1')
  })

  it('clears stalled on new activity and rearms the watchdog', () => {
    setSessionWorking('s2', true)
    vi.advanceTimersByTime(WATCHDOG_MS)
    expect($stalledSessionIds.get()).toContain('s2')

    noteSessionActivity('s2')
    expect($stalledSessionIds.get()).not.toContain('s2')

    vi.advanceTimersByTime(WATCHDOG_MS - 1)
    expect($stalledSessionIds.get()).not.toContain('s2')
    expect($workingSessionIds.get()).toContain('s2')
  })

  it('clears stalled on an authoritative terminal transition', () => {
    setSessionWorking('s3', true)
    vi.advanceTimersByTime(WATCHDOG_MS)
    expect($stalledSessionIds.get()).toContain('s3')

    setSessionWorking('s3', false)

    expect($workingSessionIds.get()).not.toContain('s3')
    expect($stalledSessionIds.get()).not.toContain('s3')
  })

  it('never marks a session stalled when it settles before the window', () => {
    setSessionWorking('s4', true)
    setSessionWorking('s4', false)

    vi.advanceTimersByTime(WATCHDOG_MS)

    expect($workingSessionIds.get()).not.toContain('s4')
    expect($stalledSessionIds.get()).not.toContain('s4')
  })
})
