import type { Project, ProjectType, SortOrder } from '@/api/types'

/** Sortable columns of the projects table. */
export type ProjectSortColumn = 'name' | 'key' | 'lead' | 'issues'

/** Current sort of the projects table. */
export interface ProjectSort {
  column: ProjectSortColumn
  order: SortOrder
}

/** Sort projects by a column (ties by name). */
export function sortProjects(projects: readonly Project[], { column, order }: ProjectSort): Project[] {
  const dir = order === 'asc' ? 1 : -1
  const byName = (a: Project, b: Project) => a.name.localeCompare(b.name)
  return [...projects].sort((a, b) => {
    let primary = 0
    if (column === 'key') primary = a.key.localeCompare(b.key)
    else if (column === 'issues') primary = a.issueCount - b.issueCount
    else if (column === 'lead') {
      if (!a.lead || !b.lead) primary = a.lead ? -1 : b.lead ? 1 : 0
      else primary = a.lead.name.localeCompare(b.lead.name)
    }
    return dir * (primary || byName(a, b))
  })
}

/** First sort direction when a column header is clicked (issue counts start with the largest). */
export function defaultProjectOrder(column: ProjectSortColumn): SortOrder {
  return column === 'issues' ? 'desc' : 'asc'
}

/** Projects whose name, key, lead or description contain `query` (case-insensitive), of an optional type. */
export function filterProjects(projects: readonly Project[], query: string, type: ProjectType | 'all'): Project[] {
  const q = query.trim().toLowerCase()
  return projects.filter((p) => {
    if (type !== 'all' && p.type !== type) return false
    if (!q) return true
    return [p.name, p.key, p.lead?.name ?? '', p.description].some((field) => field.toLowerCase().includes(q))
  })
}
