import { HttpError, ScopeError, type Http } from '../src/confluence/http/client.ts'
import { scopeFor } from '../src/confluence/reader.ts'

export interface FakeItem {
  id: string
  type: 'page' | 'folder'
  title: string
  parentId?: string
  parentType?: string
  version?: number
  marker?: unknown
  labels?: string[]
  readers?: string[]
  space?: string
}

export class FakeConfluence {
  readonly items = new Map<string, FakeItem>()
  readonly denied = new Set<string>()
  readonly calls: string[] = []
  access: { principalType: string; principalId: string }[] = []
  groups: Record<string, string> = {}

  add(item: FakeItem): this {
    this.items.set(item.id, { space: 'DOCS', ...item })
    return this
  }

  private under(id: string, ancestor: string): boolean {
    for (let item = this.items.get(id); item?.parentId; item = this.items.get(item.parentId))
      if (item.parentId === ancestor) return true
    return false
  }

  private search(cql: string): unknown[] {
    const space = /space="([^"]+)"/.exec(cql)?.[1]
    const type = /type=(\w+)/.exec(cql)?.[1]
    const title = /title="([^"]+)"/.exec(cql)?.[1]
    const contains = /title ~ "([^"]+)"/.exec(cql)?.[1]
    const ancestor = /ancestor=(\d+)/.exec(cql)?.[1]
    const label = /label="([^"]+)"/.exec(cql)?.[1]
    return [...this.items.values()]
      .filter(
        item =>
          item.space === space &&
          item.type === type &&
          (!title || item.title === title) &&
          (!contains || item.title.split(/\s+/).includes(contains)) &&
          (!ancestor || this.under(item.id, ancestor)) &&
          (!label || (item.labels ?? []).includes(label)),
      )
      .map(({ id, type: kind, title: name }) => ({ id, type: kind, title: name }))
  }

  private route(path: string): unknown {
    const url = new URL(path, 'https://x')
    const p = url.pathname
    const param = (name: string) => url.searchParams.get(name) ?? ''
    let m: RegExpExecArray | null
    if (p === '/api/v2/spaces')
      return {
        results: param('keys')
          .split(',')
          .filter(key => ['DOCS', 'ARCH'].includes(key))
          .map(key => ({ id: `space-${key}`, key, homepageId: '1' })),
      }
    if (/^\/api\/v2\/spaces\/[^/]+\/role-assignments$/.test(p))
      return { results: this.access.map(principal => ({ principal, roleId: 'viewer' })) }
    if (p === '/api/v2/pages') {
      const found = [...this.items.values()].find(item => item.type === 'page' && item.title === param('title'))
      return { results: found ? [{ id: found.id, type: 'page', title: found.title }] : [] }
    }
    if (p === '/rest/api/content/search') return { results: this.search(param('cql')) }
    if (p === '/rest/api/group/by-id') {
      const name = this.groups[param('id')]
      if (!name) throw new HttpError(404, path, '')
      return { name }
    }
    if ((m = /^\/api\/v2\/(page|folder)s\/(\d+)(?:\/(.+))?$/.exec(p))) {
      const [, type, id = '', rest] = m
      const item = this.items.get(id)
      if (!item || item.type !== type) throw new HttpError(404, path, '')
      switch (rest) {
        case undefined:
          return { ...item, ...(item.version ? { version: { number: item.version } } : {}) }
        case 'permissions':
          return {
            results: (item.readers ?? []).map(reader => {
              const [principalType = '', principalId = ''] = reader.split(':')
              return { operation: 'read', principal: { principalType, principalId } }
            }),
          }
        case 'descendants':
          return {
            results: [...this.items.values()]
              .filter(other => this.under(other.id, id))
              .map(({ id: key, type: kind, title, parentId }) => ({
                id: key,
                type: kind,
                title,
                parentId,
                status: 'current',
              })),
          }
        case 'direct-children':
          return {
            results: [...this.items.values()]
              .filter(other => other.parentId === id)
              .map(({ id: key, type: kind, title }) => ({ id: key, type: kind, title })),
          }
        case 'properties':
          return { results: item.marker === undefined ? [] : [{ value: item.marker }] }
        case 'labels':
          return { results: (item.labels ?? []).map(name => ({ name })) }
      }
    }
    throw new HttpError(400, path, 'unknown route')
  }

  readonly http: Http = {
    get: <T>(path: string) => {
      this.calls.push(path)
      if (this.denied.has(scopeFor(path))) return Promise.reject(new ScopeError(path))
      try {
        return Promise.resolve(this.route(path) as T)
      } catch (cause) {
        return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    },
    pages: async <T>(path: string) => (await this.http.get<{ results: T[] }>(path)).results,
  }
}

export const png = (width: number, height: number): Buffer => {
  const data = Buffer.alloc(32)
  data.writeUInt32BE(width, 16)
  data.writeUInt32BE(height, 20)
  return data
}

export function seeded(): FakeConfluence {
  return new FakeConfluence()
    .add({ id: '1', type: 'page', title: 'DOCS home', version: 1 })
    .add({ id: '123456', type: 'page', title: 'Payments', parentId: '1', parentType: 'page', version: 1 })
    .add({ id: '900', type: 'folder', title: 'Architecture', space: 'ARCH' })
    .add({
      id: '901',
      type: 'folder',
      title: 'External decisions',
      parentId: '900',
      parentType: 'folder',
      space: 'ARCH',
    })
    .add({ id: '902', type: 'folder', title: 'Superseded', parentId: '901', parentType: 'folder', space: 'ARCH' })
    .add({
      id: '7',
      type: 'page',
      title: 'ADR-007 Use paired regions',
      parentId: '902',
      parentType: 'folder',
      space: 'ARCH',
    })
    .add({ id: '12', type: 'page', title: 'ADR-012', parentId: '901', parentType: 'folder', space: 'ARCH' })
    .add({ id: '1200', type: 'page', title: 'ADR-0120 Other', parentId: '901', parentType: 'folder', space: 'ARCH' })
    .add({
      id: '31',
      type: 'page',
      title: 'ADR-031 Stop on leaked secrets',
      parentId: '901',
      parentType: 'folder',
      space: 'ARCH',
    })
}
