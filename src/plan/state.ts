import { z } from 'zod'
import type { Root } from '../config/schema.ts'
import type { Item, Reader } from '../confluence/reader.ts'
import { error, type Finding } from '../findings.ts'

export const markerKey = 'docs-sync'

const markerSchema = z.object({
  source: z.string().min(1),
  hash: z.string(),
  version: z.number().int(),
  signature: z.string().optional(),
})

export interface Owned {
  readonly id: string
  readonly type: Item['type']
  readonly key: string
  readonly title: string
  readonly parentId: string
  readonly version: number
  readonly hash: string
  readonly edited: boolean
  readonly markerVersion: number
  readonly first: boolean
  readonly signature?: string
}

export async function currentState(
  reader: Reader,
  root: Root,
  configFile: string,
): Promise<{ owned: Owned[]; findings: Finding[] }> {
  const nodes = (await reader.descendants(root.type, root.id)).filter(
    node => (node.type === 'page' || node.type === 'folder') && (node.status ?? 'current') === 'current',
  )
  const firsts = new Map<string, (typeof nodes)[number]>()
  for (const node of nodes) {
    const other = firsts.get(node.parentId ?? '')
    if (!other || (node.childPosition ?? 0) < (other.childPosition ?? 0)) firsts.set(node.parentId ?? '', node)
  }
  const owned: Owned[] = []
  const findings: Finding[] = []
  for (const node of nodes) {
    const type = node.type === 'folder' ? 'folder' : 'page'
    const marker = markerSchema.safeParse(await reader.property(type, node.id, markerKey))
    if (!marker.success) continue
    const page = await reader.item(type, node.id)
    if (!page) continue
    const other = owned.find(item => item.key === marker.data.source)
    if (other) {
      findings.push(
        error('plan/owner', configFile, 1, `Pages ${other.id} and ${page.id} both claim ${marker.data.source}`),
      )
      continue
    }
    owned.push({
      id: page.id,
      type,
      key: marker.data.source,
      title: page.title,
      parentId: page.parentId ?? '',
      version: type === 'page' ? (page.version ?? 0) : 0,
      hash: marker.data.hash,
      edited: type === 'page' && page.version !== marker.data.version,
      markerVersion: marker.data.version,
      first: firsts.get(node.parentId ?? '')?.id === node.id,
      ...(marker.data.signature ? { signature: marker.data.signature } : {}),
    })
  }
  return { owned, findings }
}
