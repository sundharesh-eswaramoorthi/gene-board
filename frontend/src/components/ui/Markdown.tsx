import type { ComponentProps } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/cn'

const components: Components = {
  // External links open in a new tab; in-app links stay in the SPA tab.
  a: ({ node: _node, href, children, ...props }: ComponentProps<'a'> & { node?: unknown }) => {
    const external = !!href && /^(https?:)?\/\//i.test(href)
    return (
      <a href={href} {...props} {...(external && { target: '_blank', rel: 'noopener noreferrer' })}>
        {children}
      </a>
    )
  },
}

/** Props of `Markdown`. */
export interface MarkdownProps {
  /** Markdown source (GitHub-flavoured: tables, task lists, strikethrough, autolinks). */
  children: string
  className?: string
}

/**
 * Renders user Markdown safely (no raw HTML) with the `.markdown` typography from index.css.
 * Import from `@/components/ui/Markdown` (kept out of the ui barrel so react-markdown is only
 * bundled with the features that use it).
 */
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn('markdown', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
