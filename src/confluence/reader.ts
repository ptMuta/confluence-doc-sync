import { HttpError, type Http } from './http/client.ts'

export interface Space {
  readonly id: string
  readonly key: string
  readonly homepageId: string
}

export interface Item {
  readonly id: string
  readonly type: 'page' | 'folder'
  readonly title: string
  readonly parentId?: string
  readonly parentType?: string
  readonly version?: number
}

export interface Node {
  readonly id: string
  readonly type: string
  readonly title: string
  readonly parentId?: string
  readonly status?: string
}

interface Permission {
  readonly operation: string
  readonly principalType: string
  readonly principalId: string
}

interface Attachment {
  readonly title: string
  readonly fileId: string
  readonly fileSize: number
  readonly comment?: string
}

export interface Reader {
  readonly space: (key: string) => Promise<Space | undefined>
  readonly item: (type: Item['type'], id: string) => Promise<Item | undefined>
  readonly descendants: (type: Item['type'], id: string) => Promise<Node[]>
  readonly children: (folderId: string) => Promise<Node[]>
  readonly property: (type: Item['type'], id: string, key: string) => Promise<unknown>
  readonly labels: (pageId: string) => Promise<string[]>
  readonly attachments: (pageId: string) => Promise<Attachment[]>
  readonly permissions: (type: Item['type'], id: string) => Promise<Permission[]>
  readonly roleAssignments: (spaceId: string) => Promise<Permission[]>
  readonly groupName: (id: string) => Promise<string | undefined>
  readonly pageByTitle: (spaceId: string, title: string) => Promise<Node | undefined>
  readonly search: (cql: string) => Promise<Node[]>
}

const missing = async <T>(read: Promise<T>): Promise<T | undefined> => {
  try {
    return await read
  } catch (cause) {
    if (cause instanceof HttpError && cause.status === 404) return undefined
    throw cause
  }
}

const q = encodeURIComponent

interface RawItem {
  id: string
  title: string
  parentId?: string | null
  parentType?: string | null
  version?: { number: number }
}

interface RawPermission {
  operation?: string | { key?: string }
  principal?: { principalType?: string; principalId?: string; type?: string; id?: string }
  roleId?: string
}

const permission = (raw: RawPermission): Permission => ({
  operation: typeof raw.operation === 'string' ? raw.operation : (raw.operation?.key ?? raw.roleId ?? ''),
  principalType: (raw.principal?.principalType ?? raw.principal?.type ?? '').toUpperCase(),
  principalId: raw.principal?.principalId ?? raw.principal?.id ?? '',
})

export function cloudReader(http: Http): Reader {
  return {
    space: async key =>
      (await http.get<{ results: Space[] }>(`/api/v2/spaces?keys=${q(key)}`)).results.find(space => space.key === key),
    item: async (type, id) => {
      const raw = await missing(http.get<RawItem>(`/api/v2/${type}s/${q(id)}`))
      if (!raw) return undefined
      return {
        id: raw.id,
        type,
        title: raw.title,
        ...(raw.parentId ? { parentId: raw.parentId } : {}),
        ...(raw.parentType ? { parentType: raw.parentType } : {}),
        ...(raw.version ? { version: raw.version.number } : {}),
      }
    },
    descendants: (type, id) => http.pages<Node>(`/api/v2/${type}s/${q(id)}/descendants?depth=10&limit=250`),
    children: id => http.pages<Node>(`/api/v2/folders/${q(id)}/direct-children?limit=250`),
    property: async (type, id, key) =>
      (await http.get<{ results: { value: unknown }[] }>(`/api/v2/${type}s/${q(id)}/properties?key=${q(key)}`))
        .results[0]?.value,
    labels: async pageId =>
      (await http.pages<{ name: string }>(`/api/v2/pages/${q(pageId)}/labels?limit=250`)).map(label => label.name),
    attachments: pageId => http.pages<Attachment>(`/api/v2/pages/${q(pageId)}/attachments?limit=250`),
    permissions: async (type, id) =>
      (await http.pages<RawPermission>(`/api/v2/${type}s/${q(id)}/permissions?limit=250`)).map(permission),
    roleAssignments: async spaceId =>
      (await http.pages<RawPermission>(`/api/v2/spaces/${q(spaceId)}/role-assignments?limit=250`)).map(permission),
    groupName: async id => (await missing(http.get<{ name: string }>(`/rest/api/group/by-id?id=${q(id)}`)))?.name,
    pageByTitle: async (spaceId, title) =>
      (await http.get<{ results: Node[] }>(`/api/v2/pages?space-id=${q(spaceId)}&title=${q(title)}&status=current`))
        .results[0],
    search: async cql =>
      (
        await http.pages<{ id: string; type: string; title: string; status?: string }>(
          `/rest/api/content/search?cql=${q(cql)}&limit=100`,
        )
      ).map(({ id, type, title }) => ({ id, type, title })),
  }
}

const scopes: readonly [RegExp, string][] = [
  [/^\/api\/v2\/spaces\/[^/]+\/role-assignments/, 'read:space.permission:confluence'],
  [/^\/api\/v2\/spaces/, 'read:space:confluence'],
  [/^\/api\/v2\/(?:pages|folders)\/[^/]+\/(?:descendants|direct-children)/, 'read:hierarchical-content:confluence'],
  [/^\/api\/v2\/pages\/[^/]+\/attachments/, 'read:attachment:confluence'],
  [/^\/api\/v2\/folders/, 'read:folder:confluence'],
  [/^\/api\/v2\/pages/, 'read:page:confluence'],
  [/^\/rest\/api\/group/, 'read:group:confluence'],
  [/^\/rest\/api\/content\/search/, 'search:confluence'],
  [/^\/rest\/api\/longtask/, 'read:content.metadata:confluence'],
]

export const scopeFor = (path: string): string =>
  scopes.find(([pattern]) => pattern.test(path))?.[1] ?? `the scope for ${path.split('?')[0] ?? path}`
