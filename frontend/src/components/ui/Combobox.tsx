import { Check, Search } from 'lucide-react'
import { Popover as RadixPopover } from 'radix-ui'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/cn'
import { floatingPanelClasses } from './DropdownMenu'
import { Spinner } from './Spinner'

/** One selectable row of a {@link Combobox}. */
export interface ComboboxOption<V extends string | number = string | number> {
  value: V
  /** Text used for filtering and default rendering. */
  label: string
  /** Extra text matched by the filter (e.g. an email or key). */
  keywords?: string
  /** Leading visual (icon, avatar, lozenge). */
  icon?: ReactNode
  /** Secondary text shown right-aligned / muted. */
  description?: ReactNode
  /** Custom row content (replaces icon + label + description). */
  render?: ReactNode
  disabled?: boolean
  /** Group heading; consecutive options with the same group are listed under it. */
  group?: string
  /** An action row (e.g. "Create label"): never shows a check mark / checkbox. */
  action?: boolean
}

/** Props of `Combobox`. */
export interface ComboboxProps<V extends string | number> {
  /** The trigger element (rendered via `asChild`; must forward ref/props — Buttons do). */
  trigger: ReactElement
  options: readonly ComboboxOption<V>[]
  /** Currently selected value(s): shows a check mark. */
  selected?: V | readonly V[] | null
  /** Called with the chosen option (single mode closes the popover afterwards). */
  onSelect: (option: ComboboxOption<V>) => void
  /** Multi-select: stays open after each selection and shows checkboxes. */
  multiple?: boolean
  /** Show the search box (default: true when there are more than 6 options or `onQueryChange`). */
  searchable?: boolean
  searchPlaceholder?: string
  /** Controlled search text — when set with `onQueryChange`, options are NOT filtered locally (server search). */
  query?: string
  onQueryChange?: (query: string) => void
  /** Show a spinner row (async search in flight). */
  loading?: boolean
  emptyText?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Panel width in px, or `'trigger'` to match the trigger (min 220px). Default 280. */
  width?: number | 'trigger'
  /** Content above / below the list (e.g. a hint). */
  header?: ReactNode
  footer?: ReactNode
  /** Accessible name of the listbox. */
  'aria-label'?: string
}

function includesSelected<V>(selected: V | readonly V[] | null | undefined, value: V): boolean {
  if (selected == null) return false
  return Array.isArray(selected) ? selected.includes(value) : selected === value
}

/**
 * Searchable, keyboard-navigable listbox in a popover — the engine behind every picker.
 * ↑/↓/Home/End move, Enter selects, Escape closes, typing filters.
 */
export function Combobox<V extends string | number>({
  trigger,
  options,
  selected,
  onSelect,
  multiple = false,
  searchable,
  searchPlaceholder = 'Search…',
  query: controlledQuery,
  onQueryChange,
  loading = false,
  emptyText = 'No matches',
  open: controlledOpen,
  onOpenChange,
  align = 'start',
  side = 'bottom',
  width = 280,
  header,
  footer,
  'aria-label': ariaLabel,
}: ComboboxProps<V>) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  const [localQuery, setLocalQuery] = useState('')
  const serverSearch = controlledQuery !== undefined && !!onQueryChange
  const query = serverSearch ? controlledQuery : localQuery
  const setQuery = (q: string) => (serverSearch ? onQueryChange!(q) : setLocalQuery(q))
  const showSearch = searchable ?? (serverSearch || options.length > 6)

  const filtered = useMemo(() => {
    if (serverSearch) return options
    const q = localQuery.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => `${o.label} ${o.keywords ?? ''}`.toLowerCase().includes(q))
  }, [options, localQuery, serverSearch])

  const [active, setActive] = useState(0)
  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = (i: number) => `${baseId}-opt-${i}`
  const contentRef = useRef<HTMLDivElement>(null)

  // Reset search + highlight whenever the popover opens.
  useEffect(() => {
    if (!open) return
    if (!serverSearch) setLocalQuery('')
    const idx = options.findIndex((o) => includesSelected(selected, o.value) && !o.disabled)
    setActive(idx >= 0 ? idx : Math.max(0, options.findIndex((o) => !o.disabled)))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open
  }, [open])

  // Keep the highlight inside the filtered list.
  useEffect(() => {
    setActive((a) => (a < filtered.length ? a : Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  useEffect(() => {
    if (!open) return
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open])

  const move = (delta: number) => {
    if (filtered.length === 0) return
    let next = active
    for (let i = 0; i < filtered.length; i++) {
      next = (next + delta + filtered.length) % filtered.length
      if (!filtered[next].disabled) break
    }
    setActive(next)
  }

  const choose = (option: ComboboxOption<V> | undefined) => {
    if (!option || option.disabled) return
    onSelect(option)
    if (!multiple) setOpen(false)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        move(-1)
        break
      case 'Home':
        if (!showSearch) {
          e.preventDefault()
          setActive(0)
        }
        break
      case 'End':
        if (!showSearch) {
          e.preventDefault()
          setActive(filtered.length - 1)
        }
        break
      case 'Enter':
        e.preventDefault()
        choose(filtered[active])
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  const activeDescendant = filtered.length > 0 ? optionId(active) : undefined

  return (
    <RadixPopover.Root open={open} onOpenChange={setOpen}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          side={side}
          sideOffset={4}
          collisionPadding={8}
          ref={contentRef}
          onOpenAutoFocus={(e) => {
            const el = contentRef.current?.querySelector<HTMLElement>('[data-combobox-focus]')
            if (el) {
              e.preventDefault()
              el.focus()
            }
          }}
          className={cn(floatingPanelClasses, 'flex max-h-[min(420px,var(--radix-popover-content-available-height))] flex-col overflow-hidden')}
          style={{
            width: width === 'trigger' ? 'max(220px, var(--radix-popover-trigger-width))' : width,
          }}
        >
          {showSearch && (
            <div className="flex items-center gap-2 border-b border-border px-2.5">
              <Search className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              <input
                data-combobox-focus
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-activedescendant={activeDescendant}
                aria-autocomplete="list"
                aria-label={searchPlaceholder}
                value={query}
                placeholder={searchPlaceholder}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(0)
                }}
                onKeyDown={onKeyDown}
                className="h-9 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none"
              />
              {loading && <Spinner size="xs" className="text-fg-subtle" />}
            </div>
          )}
          {header}
          <div
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            aria-multiselectable={multiple || undefined}
            aria-activedescendant={showSearch ? undefined : activeDescendant}
            tabIndex={showSearch ? -1 : 0}
            data-combobox-focus={showSearch ? undefined : ''}
            onKeyDown={showSearch ? undefined : onKeyDown}
            className="min-h-0 flex-1 overflow-y-auto p-1 focus-visible:outline-none"
          >
            {filtered.length === 0 ? (
              <div className="flex items-center justify-center gap-2 px-2 py-6 text-center text-sm text-fg-subtle">
                {loading ? <Spinner size="sm" /> : emptyText}
              </div>
            ) : (
              filtered.map((o, i) => {
                const isSelected = includesSelected(selected, o.value)
                const showGroup = o.group && (i === 0 || filtered[i - 1].group !== o.group)
                return (
                  <div key={`${o.value}`}>
                    {showGroup && (
                      <div className="px-2 pt-2 pb-1 text-2xs font-semibold tracking-wide text-fg-subtle uppercase" role="presentation">
                        {o.group}
                      </div>
                    )}
                    {/* Options are driven by aria-activedescendant from the focused input/listbox. */}
                    {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus */}
                    <div
                      id={optionId(i)}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={o.disabled || undefined}
                      data-active={i === active || undefined}
                      onPointerMove={() => i !== active && !o.disabled && setActive(i)}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => choose(o)}
                      className={cn(
                        'flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-sm select-none',
                        'data-[active]:bg-surface-hover',
                        o.disabled && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      {multiple && !o.action && (
                        <span
                          aria-hidden
                          className={cn(
                            'flex size-4 shrink-0 items-center justify-center rounded-[3px] border',
                            isSelected ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong bg-surface',
                          )}
                        >
                          {isSelected && <Check className="size-3" strokeWidth={3} />}
                        </span>
                      )}
                      {o.render ?? (
                        <>
                          {o.icon && (
                            // Decorative: the option is named by its label (avatars, icons carry their own labels).
                            <span aria-hidden className="flex shrink-0 items-center">
                              {o.icon}
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate">{o.label}</span>
                          {o.description && (
                            <span className="ml-2 shrink-0 truncate text-xs text-fg-subtle">{o.description}</span>
                          )}
                        </>
                      )}
                      {!multiple && !o.action && isSelected && <Check className="ml-auto size-4 shrink-0 text-primary" aria-hidden />}
                    </div>
                  </div>
                )
              })
            )}
          </div>
          {footer && <div className="border-t border-border p-1">{footer}</div>}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
}
