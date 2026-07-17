import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { useGatewayRequest } from '@/app/gateway/hooks/use-gateway-request'
import { useApprovalModeStatusbarItem } from '@/app/shell/approval-mode-menu'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { $activeGatewayProfile } from '@/store/profile'
import { $gatewayState } from '@/store/session'

// Same switch as before (manual/smart/off, same store, same menu copy) — this
// just renders it under the composer instead of in the statusbar, so it reads
// like Claude's own approval-mode control rather than a buried status item.
export function ComposerApprovalModeControl() {
  const profile = useStore($activeGatewayProfile)
  const gatewayState = useStore($gatewayState)
  const { requestGateway } = useGatewayRequest()
  const item = useApprovalModeStatusbarItem(profile, requestGateway)
  const [open, setOpen] = useState(false)

  if (gatewayState !== 'open') {
    return null
  }

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <DropdownMenuTrigger asChild>
        <Button
          className={cn(
            'h-(--composer-control-size) shrink-0 gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground',
            item.className
          )}
          title={item.title}
          type="button"
          variant="ghost"
        >
          {item.icon}
          <span>{item.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={item.menuAlign ?? 'start'}
        className={cn('p-0', item.menuClassName)}
        side="top"
        sideOffset={8}
      >
        {typeof item.menuContent === 'function' ? item.menuContent(() => setOpen(false)) : item.menuContent}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
