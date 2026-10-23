import { HttpError, ScopeError, type WriteHttp } from '../src/confluence/http/client.ts'
import { scopeFor } from '../src/confluence/reader.ts'

export interface FakeItem {
  id: string
  type: 'page' | 'folder'
  title: string
  parentId?: string
  parentType?: string
  version?: number
  marker?: unknown
  markerVersion?: number
  body?: unknown
  attachments?: { title: string; fileId: string; comment: string }[]
  labels?: string[]
  readers?: string[]
  space?: string
}

export class FakeConfluence {
  readonly items = new Map<string, FakeItem>()
  readonly denied = new Set<string>()
  readonly calls: string[] = []
  readonly writes: string[] = []
  readonly archived = new Set<string>()
  private next = 7000
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
          return {
            results:
              item.marker === undefined
                ? []
                : [{ id: `prop-${id}`, value: item.marker, version: { number: item.markerVersion ?? 1 } }],
          }
        case 'attachments':
          return { results: item.attachments ?? [] }
        case 'labels':
          return { results: (item.labels ?? []).map(name => ({ name })) }
      }
    }
    if (/^\/rest\/api\/longtask\/[1-9]/.test(p)) return { finished: true, successful: true }
    throw new HttpError(404, path, 'unknown route')
  }

  private page(id: string): FakeItem {
    const item = this.items.get(id)
    if (!item) throw new HttpError(404, id, '', 'PUT')
    return item
  }

  private write(method: string, path: string, body: unknown): unknown {
    const p = new URL(path, 'https://x').pathname
    const json = body as Record<string, unknown> & { value?: unknown; version?: { number: number } }
    let m: RegExpExecArray | null
    if (method === 'POST' && p === '/api/v2/pages') {
      if (!json['title']) throw new HttpError(400, path, 'invalid', method)
      const id = String(this.next++)
      this.add({
        id,
        type: 'page',
        title: json['title'] as string,
        parentId: String(json['parentId']),
        parentType: 'page',
        version: 1,
        body: json['body'],
      })
      return { id, version: { number: 1 } }
    }
    if (method === 'PUT' && (m = /^\/api\/v2\/pages\/(\d+)$/.exec(p))) {
      const item = this.page(m[1] ?? '')
      if (json.version?.number !== (item.version ?? 0) + 1) throw new HttpError(409, path, 'version conflict', method)
      Object.assign(item, { title: json['title'], body: json['body'], version: json.version.number })
      return { id: item.id, version: { number: item.version } }
    }
    if ((m = /^\/api\/v2\/pages\/(\d+)\/properties/.exec(p))) {
      const item = this.page(m[1] ?? '')
      item.marker = json.value
      item.markerVersion = json.version?.number ?? 1
      return {}
    }
    if ((m = /^\/rest\/api\/content\/(\d+)\/child\/attachment$/.exec(p))) {
      const item = this.page(m[1] ?? '')
      const form = body as FormData
      const file = form.get('file') as File
      const others = (item.attachments ?? []).filter(other => other.title !== file.name)
      item.attachments = [
        ...others,
        { title: file.name, fileId: `file-${String(this.next++)}`, comment: form.get('comment') as string },
      ]
      return {}
    }
    if ((m = /^\/rest\/api\/content\/(\d+)\/label$/.exec(p))) {
      const item = this.page(m[1] ?? '')
      const name = new URL(path, 'https://x').searchParams.get('name')
      item.labels =
        method === 'DELETE'
          ? (item.labels ?? []).filter(label => label !== name)
          : [...(item.labels ?? []), ...(body as { name: string }[]).map(label => label.name)]
      return {}
    }
    if ((m = /^\/rest\/api\/content\/(\d+)\/move\/append\/(\d+)$/.exec(p))) {
      this.page(m[1] ?? '').parentId = m[2] ?? ''
      return {}
    }
    if (p === '/rest/api/content/archive') {
      const pages = (json['pages'] as { id: number }[] | undefined) ?? []
      if (!pages.length) throw new HttpError(400, path, 'no pages', method)
      for (const { id } of pages) {
        this.archived.add(String(id))
        this.items.delete(String(id))
      }
      return { id: '1' }
    }
    throw new HttpError(400, path, 'unknown route', method)
  }

  private scope(method: string, path: string): string {
    if (method === 'GET') return scopeFor(path)
    if (path.includes('/attachment')) return 'write:attachment:confluence'
    if (path.includes('/label')) return 'write:label:confluence'
    return 'write:page:confluence'
  }

  private respond<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (method === 'GET') this.calls.push(path)
    if (this.denied.has(this.scope(method, path))) return Promise.reject(new ScopeError(path))
    try {
      if (method === 'GET') return Promise.resolve(this.route(path) as T)
      const result = this.write(method, path, body)
      this.writes.push(`${method} ${path}`)
      return Promise.resolve(result as T)
    } catch (cause) {
      return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)))
    }
  }

  readonly http: WriteHttp = {
    get: <T>(path: string) => this.respond<T>('GET', path),
    pages: async <T>(path: string) => (await this.http.get<{ results: T[] }>(path)).results,
    send: <T>(method: string, path: string, body?: unknown) => this.respond<T>(method, path, body),
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
