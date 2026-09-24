import type { Project } from '@/api/types'
import { cn } from '@/lib/cn'
import { colorForString } from '@/lib/colors'

const SIZES = {
  sm: 'size-5 rounded-[4px] text-[9px]',
  md: 'size-6 rounded-[5px] text-[10px]',
  lg: 'size-8 rounded-md text-xs',
  xl: 'size-10 rounded-lg text-sm',
} as const

/** Props of `ProjectAvatar`. */
export interface ProjectAvatarProps {
  project: Pick<Project, 'key'> & { name?: string }
  size?: keyof typeof SIZES
  className?: string
}

/** Rounded square with the project key's initials in a deterministic colour. */
export function ProjectAvatar({ project, size = 'md', className }: ProjectAvatarProps) {
  return (
    <span
      role="img"
      aria-label={project.name ?? project.key}
      className={cn('inline-flex shrink-0 items-center justify-center font-bold text-white select-none', SIZES[size], className)}
      style={{ backgroundColor: colorForString(project.key) }}
    >
      {project.key.slice(0, 2)}
    </span>
  )
}
