/**
 * Column widths shared by the epic rows and the list header, so values line up like a table.
 * Columns collapse progressively on narrow containers (`@container` on the list).
 */
export const EPIC_COLUMNS = {
  status: 'hidden w-28 shrink-0 @2xl:flex',
  progress: 'hidden w-44 shrink-0 @lg:flex',
  points: 'hidden w-24 shrink-0 justify-end @3xl:flex',
  due: 'hidden w-20 shrink-0 @3xl:flex',
  assignee: 'hidden w-6 shrink-0 justify-center @3xl:flex',
} as const
