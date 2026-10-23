const maxBytes = 50_000_000
const maxRetries = 4
const maxWaitSeconds = 60

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    detail: string,
  ) {
    super(`GET ${path} returned ${String(status)}${detail ? `: ${detail}` : ''}`)
  }
}

export class ScopeError extends Error {
  constructor(readonly path: string) {
    super(`The token lacks a scope needed for ${path}`)
  }
}

export interface Http {
  readonly get: <T>(path: string) => Promise<T>
  readonly pages: <T>(path: string) => Promise<T[]>
}

type Fetch = typeof fetch
const wait = (seconds: number) => new Promise(resolve => setTimeout(resolve, seconds * 1000))

async function body(response: Response, path: string): Promise<string> {
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > maxBytes) throw new HttpError(response.status, path, 'response too large')
  const text = await response.text()
  if (text.length > maxBytes) throw new HttpError(response.status, path, 'response too large')
  return text
}

export async function cloudId(site: string, get: Fetch = fetch): Promise<string> {
  const response = await get(`https://${site}/_edge/tenant_info`, { redirect: 'error' })
  const value: unknown = JSON.parse(await body(response, '/_edge/tenant_info'))
  const id = typeof value === 'object' && value && 'cloudId' in value ? value.cloudId : undefined
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error(`${site} returned no cloud id`)
  return id
}

export function readClient(cloud: string, token: string, get: Fetch = fetch, pause = wait): Http {
  const base = `https://api.atlassian.com/ex/confluence/${cloud}/wiki`
  const request = async (path: string): Promise<unknown> => {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error(`Refused path ${path}`)
    for (let attempt = 0; ; attempt++) {
      const response = await get(base + path, {
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
      const text = await body(response, path)
      if (response.status === 429 && attempt < maxRetries) {
        await pause(Math.min(Number(response.headers.get('retry-after')) || 2 ** attempt, maxWaitSeconds))
        continue
      }
      if ((response.status === 401 || response.status === 403) && /scope/i.test(text)) throw new ScopeError(path)
      if (!response.ok) throw new HttpError(response.status, path, text.slice(0, 200))
      return text ? JSON.parse(text) : undefined
    }
  }
  return {
    get: async <T>(path: string) => (await request(path)) as T,
    pages: async <T>(path: string) => {
      const items: T[] = []
      for (let next: string | undefined = path; next;) {
        const page = (await request(next)) as { results?: T[]; _links?: { next?: string } }
        items.push(...(page.results ?? []))
        next = page._links?.next?.replace(/^\/wiki(?=\/)/, '')
      }
      return items
    },
  }
}
