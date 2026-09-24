import { useMemo } from 'react'
import type { Project } from '@/api/types'
import { useProjects } from '@/api/projects'
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox'
import { PickerPlaceholder, PickerTrigger, type PickerCommonProps } from './PickerTrigger'
import { ProjectAvatar } from './ProjectAvatar'

/** Props of `ProjectSelect`. */
export interface ProjectSelectProps extends PickerCommonProps {
  /** Selected project key (null = none). */
  value: string | null
  onChange: (projectKey: string, project: Project) => void
  /** Restrict the offered projects, e.g. `(p) => p.myRole !== 'viewer'`. */
  filter?: (project: Project) => boolean
}

/** Picker over the caller's projects (avatar + name + key). */
export function ProjectSelect({
  value,
  onChange,
  filter,
  variant = 'field',
  disabled,
  placeholder = 'Select project',
  className,
  trigger,
  align,
  open,
  onOpenChange,
  id,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: ProjectSelectProps) {
  const projects = useProjects()
  const current = projects.data?.find((p) => p.key.toUpperCase() === value?.toUpperCase()) ?? null

  const triggerEl = trigger ?? (
    <PickerTrigger
      variant={variant}
      disabled={disabled}
      className={className}
      id={id}
      data-testid={testId}
      aria-label={ariaLabel ?? `Project: ${current?.name ?? 'none'}`}
    >
      {current ? (
        <>
          <ProjectAvatar project={current} size="sm" />
          {variant !== 'compact' && (
            <span className="truncate">
              {current.name} <span className="text-fg-subtle">({current.key})</span>
            </span>
          )}
        </>
      ) : (
        <PickerPlaceholder>{value ?? placeholder}</PickerPlaceholder>
      )}
    </PickerTrigger>
  )
  const options = useMemo<ComboboxOption<string>[]>(
    () =>
      (projects.data ?? [])
        .filter((p) => !filter || filter(p))
        .map((p) => ({
          value: p.key,
          label: p.name,
          keywords: p.key,
          icon: <ProjectAvatar project={p} size="sm" />,
          description: p.key,
        })),
    [projects.data, filter],
  )

  if (disabled) return triggerEl

  return (
    <Combobox
      trigger={triggerEl}
      options={options}
      selected={current?.key ?? null}
      loading={projects.isLoading}
      emptyText="No projects"
      searchPlaceholder="Search projects…"
      width="trigger"
      align={align}
      open={open}
      onOpenChange={onOpenChange}
      aria-label="Projects"
      onSelect={(o) => {
        const project = projects.data?.find((p) => p.key === o.value)
        if (project && project.key !== current?.key) onChange(project.key, project)
      }}
    />
  )
}
