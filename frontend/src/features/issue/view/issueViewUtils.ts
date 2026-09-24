import type { IssueLink, IssueType } from '@/api/types'

/** What a child of `parentType` is called: "child issue" under epics, "subtask" otherwise. */
export function childNoun(parentType: IssueType): string {
  return parentType === 'epic' ? 'child issue' : 'subtask'
}

/** Links grouped by their label ("blocks", "is blocked by", …) in order of first appearance. */
export function groupLinksByLabel(links: readonly IssueLink[]): [label: string, links: IssueLink[]][] {
  const groups = new Map<string, IssueLink[]>()
  for (const link of links) {
    const group = groups.get(link.label)
    if (group) group.push(link)
    else groups.set(link.label, [link])
  }
  return [...groups.entries()]
}
