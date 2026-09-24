import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/** Bordered, horizontally scrollable table container. */
export function Table({ className, containerClassName, ...props }: HTMLAttributes<HTMLTableElement> & { containerClassName?: string }) {
  return (
    <div className={cn('w-full overflow-x-auto rounded-lg border border-border bg-surface', containerClassName)}>
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  )
}

/** `<thead>` with a sunken background. */
export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-surface-sunken', className)} {...props} />
}

/** `<tbody>`. */
export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />
}

/** Row; `interactive` adds hover + pointer, `selected` highlights. */
export function TableRow({
  className,
  interactive,
  selected,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean; selected?: boolean }) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        'border-b border-border last:border-b-0',
        interactive && 'cursor-pointer hover:bg-surface-hover',
        selected && 'bg-surface-selected hover:bg-surface-selected',
        className,
      )}
      {...props}
    />
  )
}

/** Props of `TableHead`. */
export interface TableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /** Current sort direction of this column (`null`/`false` = not sorted). Omit for non-sortable. */
  sort?: 'asc' | 'desc' | null | false
  /** Makes the header a sort button. */
  onSort?: () => void
}

/** Header cell; sortable when `onSort` is given (sets aria-sort and shows an arrow). */
export function TableHead({ className, sort, onSort, children, ...props }: TableHeadProps) {
  const ariaSort = sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : onSort ? 'none' : undefined
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn('h-9 px-3 text-left align-middle text-xs font-semibold whitespace-nowrap text-fg-muted', className)}
      {...props}
    >
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          className="-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-surface-hover hover:text-fg [&_svg]:size-3.5"
        >
          {children}
          {sort === 'asc' ? <ArrowUp /> : sort === 'desc' ? <ArrowDown /> : <ChevronsUpDown className="opacity-50" />}
        </button>
      ) : (
        children
      )}
    </th>
  )
}

/** Body cell. */
export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('h-10 px-3 align-middle', className)} {...props} />
}
