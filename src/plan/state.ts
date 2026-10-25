import { z } from 'zod'
import type { Root } from '../config/schema.ts'
import type { Reader } from '../confluence/reader.ts'
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
  readonly key: string
  readonly title: string
  readonly parentId: string
  readonly version: number
  readonly hash: string
  readonly edited: boolean
  readonly markerVersion: number
  readonly signature?: string
}

export async function currentState(
  reader: Reader,
  root: Root,
  configFile: string,
): Promise<{ owned: Owned[]; findings: Finding[] }> {
  const nodes = (await reader.descendants(root.type, root.id)).filter(
    node => node.type === 'page' && (node.status ?? 'current') === 'current',
  )
  const owned: Owned[] = []
  const findings: Finding[] = []
  for (const node of nodes) {
    const marker = markerSchema.safeParse(await reader.property(node.id, markerKey))
    if (!marker.success) continue
    const page = await reader.item('page', node.id)
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
      key: marker.data.source,
      title: page.title,
      parentId: page.parentId ?? '',
      version: page.version ?? 0,
      hash: marker.data.hash,
      edited: page.version !== marker.data.version,
      markerVersion: marker.data.version,
      ...(marker.data.signature ? { signature: marker.data.signature } : {}),
    })
  }
  return { owned, findings }
}
