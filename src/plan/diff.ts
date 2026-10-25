import type { Config } from '../config/schema.ts'
import { error, warning, type Finding } from '../findings.ts'
import type { DesiredFolder, DesiredPage } from './desired.ts'
import type { Owned } from './state.ts'

type Parent = { readonly page: string } | { readonly key: string }

export type Op =
  | {
      readonly kind: 'create'
      readonly key: string
      readonly title: string
      readonly parent: Parent
      readonly folder?: true | undefined
    }
  | {
      readonly kind: 'update'
      readonly key: string
      readonly page: string
      readonly title: string
      readonly changes: readonly ('content' | 'title' | 'manual-edit')[]
    }
  | { readonly kind: 'move'; readonly key: string; readonly page: string; readonly from: string; readonly to: Parent }
  | {
      readonly kind: 'archive'
      readonly key: string
      readonly page: string
      readonly title: string
      readonly folder?: true | undefined
    }

export type Risk = 'low' | 'high'

export interface Classified {
  readonly op: Op
  readonly risky?: string
}

export function diff(
  desired: readonly DesiredPage[],
  folders: readonly DesiredFolder[],
  owned: readonly Owned[],
  root: string,
): { ops: Op[]; findings: Finding[] } {
  const byKey = new Map(owned.map(page => [page.key, page]))
  const parentOf = (page: DesiredPage | DesiredFolder): Parent => {
    if (!page.parent) return { page: root }
    const existing = byKey.get(page.parent)
    return existing ? { page: existing.id } : { key: page.parent }
  }
  const ops: Op[] = []
  const findings: Finding[] = []
  for (const folder of folders)
    if (!byKey.has(folder.key))
      ops.push({ kind: 'create', key: folder.key, title: folder.title, parent: parentOf(folder), folder: true })
  for (const page of desired) {
    const current = byKey.get(page.key)
    const parent = parentOf(page)
    if (!current) {
      ops.push({ kind: 'create', key: page.key, title: page.title, parent })
      continue
    }
    if (!('page' in parent) || parent.page !== current.parentId)
      ops.push({ kind: 'move', key: page.key, page: current.id, from: current.parentId, to: parent })
    const changes = [
      ...(current.hash !== page.hash ? (['content'] as const) : []),
      ...(current.title !== page.title ? (['title'] as const) : []),
      ...(current.edited ? (['manual-edit'] as const) : []),
    ]
    if (current.edited)
      findings.push(warning('plan/manual-edit', page.key, 1, `Page ${current.id} was edited in Confluence`))
    if (changes.length) ops.push({ kind: 'update', key: page.key, page: current.id, title: page.title, changes })
  }
  const keys = new Set([...desired, ...folders].map(item => item.key))
  for (const item of owned)
    if (!keys.has(item.key))
      ops.push({
        kind: 'archive',
        key: item.key,
        page: item.id,
        title: item.title,
        ...(item.type === 'folder' ? { folder: true as const } : {}),
      })
  return { ops, findings }
}

export function titleClashes(
  ops: readonly Op[],
  existing: ReadonlyMap<string, string | undefined>,
  owned: readonly Owned[],
): Finding[] {
  const ours = new Set(owned.map(page => page.id))
  return ops.flatMap(op => {
    if (!(op.kind === 'create' && !op.folder) && !(op.kind === 'update' && op.changes.includes('title'))) return []
    const other = existing.get(op.title)
    return other && !ours.has(other)
      ? [error('plan/title-clash', op.key, 1, `Page ${other} in the space already has the title "${op.title}"`)]
      : []
  })
}

export function classify(ops: readonly Op[], deviating: ReadonlySet<string>): Classified[] {
  return ops.map(op => {
    switch (op.kind) {
      case 'create':
        if (op.folder) return { op, risky: 'new folder' }
        return { op, risky: deviating.has(op.key) ? 'new page with deviates-from links' : 'new page' }
      case 'archive':
        return { op, risky: op.folder ? 'deletes a folder' : 'archives a page' }
      case 'move':
        return { op, risky: 'moves a page' }
      case 'update':
        if (op.changes.includes('manual-edit')) return { op, risky: 'overwrites a manual edit' }
        if (op.changes.includes('content') && deviating.has(op.key))
          return { op, risky: 'changes a page with deviates-from links' }
        return { op }
    }
  })
}

export function overallRisk(approval: Config['approval'], classified: readonly Classified[]): Risk {
  if (!classified.length || approval === 'none') return 'low'
  if (approval === 'always') return 'high'
  return classified.some(item => item.risky) ? 'high' : 'low'
}
