import { rootOf, type Config } from '../config/schema.ts'
import type { Item, Reader, Space } from '../confluence/reader.ts'
import { error, type Finding } from '../findings.ts'

const openClasses = ['anonymous-users', 'authenticated-users']
const maxDepth = 50

interface Level {
  readonly type: Item['type']
  readonly id: string
  readonly readers: readonly string[]
}

export interface Visibility {
  readonly mode: Config['confluence']['visibility']
  readonly openTo: readonly string[]
  readonly chain: readonly Level[]
}

const isContent = (type: string | undefined): type is Item['type'] => type === 'page' || type === 'folder'

async function chain(reader: Reader, root: { type: Item['type']; id: string }): Promise<Level[]> {
  const levels: Level[] = []
  let next: { type: Item['type']; id: string } | undefined = root
  while (next && levels.length < maxDepth) {
    const item = await reader.item(next.type, next.id)
    if (!item) throw new Error(`Cannot read ${next.type} ${next.id} above the root`)
    const readers = (await reader.permissions(item.type, item.id))
      .filter(permission => permission.operation === 'read')
      .map(permission => `${permission.principalType.toLowerCase()}:${permission.principalId}`)
    levels.push({ type: item.type, id: item.id, readers: readers.sort() })
    next = item.parentId && isContent(item.parentType) ? { type: item.parentType, id: item.parentId } : undefined
  }
  return levels
}

export async function checkVisibility(
  reader: Reader,
  config: Config,
  space: Space,
  configFile: string,
): Promise<{ visibility: Visibility; findings: Finding[] }> {
  const { visibility: mode, readers } = config.confluence
  const assignments = await reader.roleAssignments(space.id)
  const openTo = [
    ...new Set(
      assignments
        .filter(a => a.principalType === 'ACCESS_CLASS' && openClasses.includes(a.principalId))
        .map(a => a.principalId),
    ),
  ].sort()
  const levels = await chain(reader, rootOf(config))
  const findings: Finding[] = []
  const fail = (rule: string, message: string) => findings.push(error(rule, configFile, 1, message))
  if (mode !== 'public' && openTo.length)
    fail(
      'visibility/space',
      `Space ${space.key} is open to ${openTo.join(', ')}; remove that access or set confluence.visibility: public`,
    )
  const nearest = levels.find(level => level.readers.length)
  if (mode === 'restricted' && !nearest)
    fail('visibility/restricted', 'Neither the root nor any page or folder above it restricts who can view it')
  if (readers && nearest) {
    const groups = await Promise.all(
      nearest.readers
        .filter(principal => principal.startsWith('group:'))
        .map(async principal => {
          const id = principal.slice('group:'.length)
          return (await reader.groupName(id)) ?? id
        }),
    )
    const expected = [...new Set(readers)].sort()
    const actual = [...new Set(groups)].sort()
    if (expected.join('\n') !== actual.join('\n'))
      fail(
        'visibility/readers',
        `${nearest.type} ${nearest.id} lets ${actual.join(', ') || 'no groups'} view it; expected ${expected.join(', ')}`,
      )
  }
  return { visibility: { mode, openTo, chain: levels }, findings }
}
