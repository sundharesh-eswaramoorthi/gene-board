import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type Theme } from '@/app/ThemeProvider'
import { DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/DropdownMenu'
import { IconButton } from '@/components/ui/IconButton'

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

/** "Theme" radio section for a DropdownMenu (Light / Dark / System). */
export function ThemeMenuItems() {
  const { theme, setTheme } = useTheme()
  return (
    <>
      <DropdownMenuLabel>Theme</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <DropdownMenuRadioItem key={value} value={value} onSelect={(e) => e.preventDefault()}>
            <Icon className="size-4 text-fg-muted" aria-hidden />
            {label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  )
}

/** Stand-alone icon button cycling light → dark → system (used on the auth pages). */
export function ThemeToggleButton({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const index = OPTIONS.findIndex((o) => o.value === theme)
  const current = OPTIONS[index] ?? OPTIONS[2]
  const next = OPTIONS[(index + 1) % OPTIONS.length]
  const Icon = current.icon
  return (
    <IconButton
      className={className}
      label={`Theme: ${current.label} (switch to ${next.label.toLowerCase()})`}
      tooltip={`Theme: ${current.label}`}
      icon={<Icon />}
      onClick={() => setTheme(next.value)}
    />
  )
}
