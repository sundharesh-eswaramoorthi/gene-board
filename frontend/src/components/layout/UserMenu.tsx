import { LogOut, UserCog } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { UserAvatar } from '@/components/issue/UserAvatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { AccountDialog } from './AccountDialog'
import { ThemeMenuItems } from './ThemeMenu'

/** Avatar button with account settings, theme choice and log out. */
export function UserMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [accountOpen, setAccountOpen] = useState(false)
  if (!user) return null
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Account menu for ${user.name}`}
            className="flex size-8 items-center justify-center rounded-full hover:bg-surface-hover data-[state=open]:bg-surface-hover"
          >
            <UserAvatar user={user} size="md" tooltip={false} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="flex items-center gap-3 px-2 py-2">
            <UserAvatar user={user} size="lg" tooltip={false} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              <p className="truncate text-xs text-fg-muted">{user.email}</p>
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={<UserCog />} onSelect={() => setAccountOpen(true)}>
            Account settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <ThemeMenuItems />
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={<LogOut />}
            onSelect={() => {
              logout()
              navigate('/login', { replace: true })
            }}
          >
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {accountOpen && <AccountDialog open onOpenChange={setAccountOpen} />}
    </>
  )
}
