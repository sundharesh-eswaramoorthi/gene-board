import type { MouseEvent, ReactNode } from 'react'
import { Link } from 'react-router'
import { useIssueModal } from '@/app/ModalsProvider'
import { cn } from '@/lib/cn'

/** Props of {@link IssueOpenLink}. */
export interface IssueOpenLinkProps {
  issueKey: string
  children: ReactNode
  className?: string
  title?: string
}

/**
 * A link to `/browse/KEY` that opens the issue modal on a plain click (modifier / middle
 * clicks keep the browser's default: open the full page in a new tab). Unlike the shared
 * IssueKeyLink it carries arbitrary content (e.g. the summary) and no key styling. It stops
 * propagation so it can sit inside clickable rows.
 */
export function IssueOpenLink({ issueKey, children, className, title }: IssueOpenLinkProps) {
  const { openIssue } = useIssueModal()
  const key = issueKey.toUpperCase()
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation()
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    openIssue(key)
  }
  return (
    <Link to={`/browse/${key}`} onClick={onClick} title={title} className={cn('rounded-[2px]', className)}>
      {children}
    </Link>
  )
}
