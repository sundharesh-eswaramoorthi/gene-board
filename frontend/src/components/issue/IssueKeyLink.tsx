import type { MouseEvent, ReactNode } from 'react'
import { Link } from 'react-router'
import { useIssueModalOptional } from '@/app/ModalsProvider'
import { cn } from '@/lib/cn'

/** Props of `IssueKeyLink`. */
export interface IssueKeyLinkProps {
  issueKey: string
  /** `link` (primary colour, default) or `muted` (grey, e.g. on board cards). */
  tone?: 'link' | 'muted'
  /** Strike through (resolved issues). */
  done?: boolean
  /** Link text (defaults to the key). */
  children?: ReactNode
  className?: string
}

/**
 * Issue key that opens the issue modal on click (`?issue=KEY`); modifier-click / middle-click
 * open the full page `/browse/KEY` in a new tab. Stops propagation so it works inside
 * clickable rows/cards.
 */
export function IssueKeyLink({ issueKey, tone = 'link', done = false, children, className }: IssueKeyLinkProps) {
  const modal = useIssueModalOptional()
  const key = issueKey.toUpperCase()
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation()
    if (!modal || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    modal.openIssue(key)
  }
  return (
    <Link
      to={`/browse/${key}`}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        'shrink-0 rounded-[2px] font-medium whitespace-nowrap hover:underline',
        tone === 'link' ? 'text-primary' : 'text-fg-muted hover:text-fg',
        done && 'line-through',
        className,
      )}
    >
      {children ?? key}
    </Link>
  )
}
