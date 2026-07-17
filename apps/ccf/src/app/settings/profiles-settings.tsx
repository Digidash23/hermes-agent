import { useI18n } from '@/i18n'
import { Users } from '@/lib/icons'

import { ProfileRail } from '../chat/sidebar/profile-switcher'

import { SectionHeading, SettingsContent } from './primitives'

// ProfileRail moved here from the sidebar footer — CCF's simplified sidebar
// only shows pages/search/pinned/sessions; profile switching now lives in
// Settings instead. The rail component itself is unchanged (still its own
// nanostores-backed switcher/create/rename/delete/recolor UI).
export function ProfilesSettings() {
  const { t } = useI18n()

  return (
    <SettingsContent>
      <SectionHeading icon={Users} title={t.profiles.title} />
      <div className="rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-editor) p-3">
        <ProfileRail />
      </div>
    </SettingsContent>
  )
}
