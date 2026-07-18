import { useI18n } from '@/i18n'
import { Clock } from '@/lib/icons'

import { SettingsContent } from './primitives'

export function BillingSettings() {
  const { t } = useI18n()
  const b = t.settings.billing

  return (
    <SettingsContent>
      <div className="flex flex-col items-center gap-3 pt-16 pb-2 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted/40 text-muted-foreground">
          <Clock className="size-5" />
        </div>
        <div className="max-w-sm">
          <h2 className="text-lg font-semibold tracking-tight">{b.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{b.blurb}</p>
        </div>
      </div>
    </SettingsContent>
  )
}
