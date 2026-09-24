import type { IssueRef } from '@/api/types'
import { useIssueModalOptional } from '@/app/ModalsProvider'
import { cn } from '@/lib/cn'
import { chipStyle, epicColor } from '@/lib/colors'

/** Props of `EpicChip`. */
export interface EpicChipProps {
  epic: Pick<IssueRef, 'id' | 'summary'> & { key?: string }
  /** Clicking opens the epic in the issue modal (needs `epic.key`). Default false. */
  interactive?: boolean
  className?: string
}

/** Epic name in the epic's deterministic colour (used on cards, rows and filters). */
export function EpicChip({ epic, interactive = false, className }: EpicChipProps) {
  const modal = useIssueModalOptional()
  const classes = cn(
    'chip-tint inline-flex h-5 max-w-40 shrink-0 items-center rounded-[3px] px-1.5 text-2xs font-semibold whitespace-nowrap',
    className,
  )
  const content = <span className="truncate">{epic.summary}</span>
  if (interactive && epic.key && modal) {
    const key = epic.key
    return (
      <button
        type="button"
        title={`${key}: ${epic.summary}`}
        style={chipStyle(epicColor(epic.id))}
        className={cn(classes, 'hover:underline')}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          modal.openIssue(key)
        }}
      >
        {content}
      </button>
    )
  }
  return (
    <span title={epic.key ? `${epic.key}: ${epic.summary}` : epic.summary} style={chipStyle(epicColor(epic.id))} className={classes}>
      {content}
    </span>
  )
}
