import type { Node } from '../render/adf.ts'
import { HttpError, ScopeError, type WriteHttp } from './http/client.ts'

const q = encodeURIComponent
const maxPolls = 60

export interface Writer {
  readonly createPage: (spaceId: string, parentId: string, title: string) => Promise<{ id: string; version: number }>
  readonly updatePage: (id: string, title: string, body: Node, version: number) => Promise<number>
  readonly setProperty: (pageId: string, key: string, value: unknown) => Promise<void>
  readonly upload: (pageId: string, name: string, data: Buffer, comment: string) => Promise<void>
  readonly addLabels: (pageId: string, names: readonly string[]) => Promise<void>
  readonly removeLabel: (pageId: string, name: string) => Promise<void>
  readonly move: (pageId: string, parentId: string) => Promise<void>
  readonly archive: (pageIds: readonly string[]) => Promise<void>
}

const adf = (body: Node) => ({ representation: 'atlas_doc_format', value: JSON.stringify(body) })

interface Page {
  id: string
  version: { number: number }
}

const wait = (seconds: number) => new Promise(resolve => setTimeout(resolve, seconds * 1000))

export function cloudWriter(http: WriteHttp, pause = wait): Writer {
  return {
    createPage: async (spaceId, parentId, title) => {
      const page = await http.send<Page>('POST', '/api/v2/pages', {
        spaceId,
        status: 'current',
        title,
        parentId,
        body: adf({ type: 'doc', attrs: { version: 1 }, content: [] }),
      })
      return { id: page.id, version: page.version.number }
    },
    updatePage: async (id, title, body, version) =>
      (
        await http.send<Page>('PUT', `/api/v2/pages/${q(id)}`, {
          id,
          status: 'current',
          title,
          body: adf(body),
          version: { number: version, message: 'docs-sync' },
        })
      ).version.number,
    setProperty: async (pageId, key, value) => {
      const path = `/api/v2/pages/${q(pageId)}/properties`
      const [current] = (await http.get<{ results: Page[] }>(`${path}?key=${q(key)}`)).results
      if (current)
        await http.send('PUT', `${path}/${q(current.id)}`, {
          key,
          value,
          version: { number: current.version.number + 1 },
        })
      else await http.send('POST', path, { key, value })
    },
    upload: async (pageId, name, data, comment) => {
      const form = new FormData()
      form.append(
        'file',
        new Blob([new Uint8Array(data)], {
          type: name.endsWith('.drawio') ? 'application/vnd.jgraph.mxfile' : 'image/png',
        }),
        name,
      )
      form.append('comment', comment)
      form.append('minorEdit', 'true')
      await http.send('PUT', `/rest/api/content/${q(pageId)}/child/attachment`, form)
    },
    addLabels: async (pageId, names) => {
      await http.send(
        'POST',
        `/rest/api/content/${q(pageId)}/label`,
        names.map(name => ({ prefix: 'global', name })),
      )
    },
    removeLabel: async (pageId, name) => {
      await http.send('DELETE', `/rest/api/content/${q(pageId)}/label?name=${q(name)}`)
    },
    move: async (pageId, parentId) => {
      await http.send('PUT', `/rest/api/content/${q(pageId)}/move/append/${q(parentId)}`)
    },
    archive: async pageIds => {
      const task = await http.send<{ id: string }>('POST', '/rest/api/content/archive', {
        pages: pageIds.map(id => ({ id: Number(id) })),
      })
      for (let poll = 0; poll < maxPolls; poll++) {
        const status = await http.get<{
          finished?: boolean
          successful?: boolean
          messages?: { translation?: string }[]
        }>(`/rest/api/longtask/${q(task.id)}`)
        if (status.finished) {
          if (status.successful) return
          throw new Error(
            `Archiving failed: ${(status.messages ?? []).map(message => message.translation).join('; ') || 'no reason given'}`,
          )
        }
        await pause(2)
      }
      throw new Error(`Archiving did not finish; check long task ${task.id}`)
    },
  }
}

const probes: readonly [string, (http: WriteHttp) => Promise<unknown>][] = [
  ['write:page:confluence', http => http.send('POST', '/api/v2/pages', {})],
  ['write:attachment:confluence', http => http.send('PUT', '/rest/api/content/0/child/attachment', new FormData())],
  ['write:label:confluence', http => http.send('POST', '/rest/api/content/0/label', [])],
  ['read:content.metadata:confluence', http => http.get('/rest/api/longtask/0')],
]

export async function missingWriteScopes(http: WriteHttp): Promise<string[]> {
  const missing = await Promise.all(
    probes.map(async ([scope, probe]) => {
      try {
        await probe(http)
        return undefined
      } catch (cause) {
        if (cause instanceof ScopeError) return scope
        if (cause instanceof HttpError) return undefined
        throw cause
      }
    }),
  )
  return missing.filter(scope => scope !== undefined)
}
