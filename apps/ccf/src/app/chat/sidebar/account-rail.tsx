import { useNavigate } from 'react-router-dom'

import { ChevronDown } from '@/lib/icons'
import { profileColor, profileColorSoft } from '@/lib/profile-color'
import { cn } from '@/lib/utils'

import { SETTINGS_ROUTE } from '../../routes'

// Placeholder account row for the sidebar footer — Hermes' backend has no
// user-account concept yet (OAuth here connects LLM *providers*, not an app
// account), so name/role are static until CCF has a real account system to
// read from. Visually matches the target: avatar, name, role, chevron.
const ACCOUNT_NAME = 'Marty'
const ACCOUNT_ROLE = 'Admin'

export function AccountRail() {
  const navigate = useNavigate()
  const hue = profileColor(ACCOUNT_NAME) ?? 'var(--ui-text-quaternary)'

  return (
    <button
      aria-label={`${ACCOUNT_NAME} · ${ACCOUNT_ROLE}`}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
        'hover:bg-(--ui-control-hover-background)'
      )}
      onClick={() => navigate(SETTINGS_ROUTE)}
      type="button"
    >
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-full text-[0.6875rem] font-semibold uppercase leading-none"
        style={{ backgroundColor: profileColorSoft(hue, 28), color: hue }}
      >
        {ACCOUNT_NAME.charAt(0)}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[0.8125rem] text-(--ui-text-secondary)">
        <span className="truncate font-medium text-foreground">{ACCOUNT_NAME}</span>
        <span className="text-(--ui-text-quaternary)">·</span>
        <span className="truncate">{ACCOUNT_ROLE}</span>
      </span>
      <ChevronDown className="size-3.5 shrink-0 text-(--ui-text-tertiary)" />
    </button>
  )
}
