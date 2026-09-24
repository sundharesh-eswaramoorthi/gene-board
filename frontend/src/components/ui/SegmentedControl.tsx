import { ToggleGroup } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** One option of a SegmentedControl. */
export interface SegmentedOption<V extends string> {
  value: V
  label: ReactNode
  /** Accessible label when `label` is an icon. */
  'aria-label'?: string
}

/** Props of `SegmentedControl`. */
export interface SegmentedControlProps<V extends string> {
  value: V
  onChange: (value: V) => void
  options: readonly SegmentedOption<V>[]
  size?: 'sm' | 'md'
  className?: string
  'aria-label'?: string
}

/** Single-choice segmented toggle (Radix ToggleGroup), e.g. view switches. */
export function SegmentedControl<V extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
  ...aria
}: SegmentedControlProps<V>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as V)}
      className={cn('inline-flex w-fit items-center gap-0.5 rounded-md bg-surface-sunken p-0.5', className)}
      {...aria}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          aria-label={o['aria-label']}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 rounded-sm font-medium text-fg-muted transition-colors hover:text-fg [&_svg]:size-4',
            size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-sm',
            'data-[state=on]:bg-surface data-[state=on]:text-fg data-[state=on]:shadow-card',
          )}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}
