const maxBytes = 50_000_000
const maxRetries = 4
const maxWaitSeconds = 60

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    detail: string,
    method = 'GET',
  ) {
    super(`${method} ${path} returned ${String(status)}${detail ? `: ${detail}` : ''}`)
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

export interface WriteHttp extends Http {
  readonly send: <T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<T>
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

export async function accessToken(clientId: string, clientSecret: string, get: Fetch = fetch): Promise<string> {
  const path = '/oauth/token'
  const response = await get(`https://auth.atlassian.com${path}`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  })
  const text = await body(response, path)
  if (!response.ok) throw new HttpError(response.status, path, text.slice(0, 200), 'POST')
  const value: unknown = JSON.parse(text)
  const token = typeof value === 'object' && value && 'access_token' in value ? value.access_token : undefined
  if (typeof token !== 'string' || !token) throw new Error('Atlassian returned no access token')
  return token
}

function client(cloud: string, token: string, get: Fetch, pause: typeof wait): WriteHttp {
  const base = `https://api.atlassian.com/ex/confluence/${cloud}/wiki`
  const request = async (method: string, path: string, payload?: unknown): Promise<unknown> => {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error(`Refused path ${path}`)
    const form = payload instanceof FormData
    for (let attempt = 0; ; attempt++) {
      const response = await get(base + path, {
        method,
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(form ? { 'X-Atlassian-Token': 'no-check' } : {}),
          ...(payload !== undefined && !form ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(payload === undefined ? {} : { body: form ? payload : JSON.stringify(payload) }),
      })
      const text = await body(response, path)
      if (response.status === 429 && attempt < maxRetries) {
        await pause(Math.min(Number(response.headers.get('retry-after')) || 2 ** attempt, maxWaitSeconds))
        continue
      }
      if ((response.status === 401 || response.status === 403) && /scope/i.test(text)) throw new ScopeError(path)
      if (!response.ok) throw new HttpError(response.status, path, text.slice(0, 200), method)
      return text ? JSON.parse(text) : undefined
    }
  }
  return {
    get: async <T>(path: string) => (await request('GET', path)) as T,
    pages: async <T>(path: string) => {
      const items: T[] = []
      for (let next: string | undefined = path; next;) {
        const page = (await request('GET', next)) as { results?: T[]; _links?: { next?: string } }
        items.push(...(page.results ?? []))
        next = page._links?.next?.replace(/^\/wiki(?=\/)/, '')
      }
      return items
    },
    send: async <T>(method: string, path: string, payload?: unknown) => (await request(method, path, payload)) as T,
  }
}

export function readClient(cloud: string, token: string, get: Fetch = fetch, pause = wait): Http {
  const { get: read, pages } = client(cloud, token, get, pause)
  return { get: read, pages }
}

export const writeClient = (cloud: string, token: string, get: Fetch = fetch, pause = wait): WriteHttp =>
  client(cloud, token, get, pause)
