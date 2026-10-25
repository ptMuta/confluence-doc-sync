import { describe, expect, it, vi } from 'vitest'
import {
  cloudId,
  HttpError,
  readClient,
  ScopeError,
  writeClient,
  type Http,
  type WriteHttp,
} from '../src/confluence/http/client.ts'
import { missingScopes } from '../src/confluence/preflight.ts'
import { cloudReader, scopeFor } from '../src/confluence/reader.ts'
import { cloudWriter, missingWriteScopes } from '../src/confluence/writer.ts'
import { currentState } from '../src/plan/state.ts'
import { FakeConfluence } from './fake-confluence.ts'

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })

const cloud = '0bd2ba39-2a5c-4e4b-9e8a-2f7f0c2d1a10'

describe('readClient', () => {
  it('sends a bearer token, refuses redirects and follows cursors', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(reply(200, { results: [1], _links: { next: '/wiki/api/v2/pages?cursor=b' } }))
      .mockResolvedValueOnce(reply(200, { results: [2] }))
    const http = readClient(cloud, 'secret', fetch)
    expect(await http.pages('/api/v2/pages')).toEqual([1, 2])
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `https://api.atlassian.com/ex/confluence/${cloud}/wiki/api/v2/pages`,
      `https://api.atlassian.com/ex/confluence/${cloud}/wiki/api/v2/pages?cursor=b`,
    ])
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: 'Bearer secret' },
    })
  })

  it('backs off on 429 up to a ceiling', async () => {
    const pause = vi.fn(() => Promise.resolve())
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(reply(429, '', { 'retry-after': '3' }))
      .mockResolvedValueOnce(reply(429, ''))
      .mockResolvedValueOnce(reply(200, ''))
    expect(await readClient(cloud, 't', fetch, pause).get('/x')).toBeUndefined()
    expect(pause.mock.calls).toEqual([[3], [2]])
    const always = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(reply(429, 'slow down')))
    await expect(readClient(cloud, 't', always, pause).get('/x')).rejects.toThrow('GET /x returned 429: slow down')
    expect(always).toHaveBeenCalledTimes(5)
  })

  it('tells scope errors apart and refuses odd paths and huge bodies', async () => {
    const scoped = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(reply(401, { code: 401, message: 'Unauthorized; scope does not match' })),
    )
    await expect(readClient(cloud, 't', scoped).get('/api/v2/pages/1')).rejects.toBeInstanceOf(ScopeError)
    const missing = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(reply(404, '')))
    await expect(readClient(cloud, 't', missing).get('/a')).rejects.toBeInstanceOf(HttpError)
    await expect(readClient(cloud, 't', missing).get('//evil.example/a')).rejects.toThrow('Refused path')
    await expect(readClient(cloud, 't', missing).get('https://evil.example/a')).rejects.toThrow('Refused path')
    const huge = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(reply(200, '{}', { 'content-length': '60000000' })),
    )
    await expect(readClient(cloud, 't', huge).get('/a')).rejects.toThrow('response too large')
  })

  it('reads the cloud id from the site', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(reply(200, { cloudId: cloud })))
    expect(await cloudId('acme.atlassian.net', fetch)).toBe(cloud)
    expect(fetch).toHaveBeenCalledWith('https://acme.atlassian.net/_edge/tenant_info', { redirect: 'error' })
    const bad = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(reply(200, { cloudId: 'x' })))
    await expect(cloudId('acme.atlassian.net', bad)).rejects.toThrow('returned no cloud id')
  })
})

describe('reader', () => {
  it('maps v2 permission shapes and missing items', async () => {
    const fake = new FakeConfluence().add({ id: '1', type: 'page', title: 'Home', readers: ['group:g'] })
    const reader = cloudReader(fake.http)
    expect(await reader.permissions('page', '1')).toEqual([
      { operation: 'read', principalType: 'GROUP', principalId: 'g' },
    ])
    expect(await reader.item('folder', '1')).toBeUndefined()
    expect(await reader.groupName('nope')).toBeUndefined()
    expect(await reader.labels('1')).toEqual([])
    const http = {
      get: vi.fn(),
      pages: vi.fn(() =>
        Promise.resolve([{ operation: { key: 'read' }, principal: { type: 'user', id: 'u' } }, { roleId: 'r' }]),
      ),
    }
    expect(await cloudReader(http as unknown as Http).roleAssignments('s')).toEqual([
      { operation: 'read', principalType: 'USER', principalId: 'u' },
      { operation: 'r', principalType: '', principalId: '' },
    ])
    expect(await cloudReader(http as unknown as Http).attachments('1')).toHaveLength(2)
    http.get.mockRejectedValue(new HttpError(500, '/x', ''))
    await expect(cloudReader(http as unknown as Http).item('page', '1')).rejects.toThrow('returned 500')
  })

  it('names scopes by path', () => {
    expect(scopeFor('/api/v2/pages/1/descendants')).toBe('read:hierarchical-content:confluence')
    expect(scopeFor('/api/v2/spaces/1/role-assignments')).toBe('read:space.permission:confluence')
    expect(scopeFor('/rest/api/other?x=1')).toBe('the scope for /rest/api/other')
  })

  it('passes unexpected errors through the preflight', async () => {
    const http = { get: () => Promise.reject(new Error('network down')), pages: vi.fn() }
    await expect(missingScopes(http as unknown as Http, ['/a'])).rejects.toThrow('network down')
  })
})

describe('currentState', () => {
  it('skips unmarked pages and refuses two pages claiming one source', async () => {
    const fake = new FakeConfluence()
      .add({ id: '1', type: 'page', title: 'Root', version: 1 })
      .add({
        id: '2',
        type: 'page',
        title: 'A',
        parentId: '1',
        version: 2,
        marker: { source: 'a.md', hash: 'h', version: 2 },
      })
      .add({
        id: '3',
        type: 'page',
        title: 'B',
        parentId: '1',
        version: 1,
        marker: { source: 'a.md', hash: 'h', version: 1 },
      })
      .add({ id: '4', type: 'page', title: 'C', parentId: '1', version: 1, marker: { bogus: true } })
    const { owned, findings } = await currentState(cloudReader(fake.http), { type: 'page', id: '1' }, 'config.yaml')
    expect(owned.map(page => page.id)).toEqual(['2'])
    expect(findings.map(finding => finding.message)).toEqual(['Pages 2 and 3 both claim a.md'])
  })
})

describe('writer', () => {
  it('sends JSON and multipart bodies with the method in errors', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(reply(200, { id: '5', version: { number: 1 } }))
      .mockResolvedValueOnce(reply(200, ''))
      .mockResolvedValueOnce(reply(400, 'bad'))
    const writer = cloudWriter(writeClient(cloud, 't', fetch))
    expect(await writer.createPage('s', '1', 'Title')).toEqual({ id: '5', version: 1 })
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    await writer.upload('5', 'a.png', Buffer.from('x'), 'sum')
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT', headers: { 'X-Atlassian-Token': 'no-check' } })
    expect(fetch.mock.calls[1]?.[1]?.body).toBeInstanceOf(FormData)
    await expect(writer.move('5', '1')).rejects.toThrow('PUT /rest/api/content/5/move/append/1 returned 400: bad')
  })

  it('waits for archiving and reports failures', async () => {
    const pause = vi.fn(() => Promise.resolve())
    const http = (...statuses: unknown[]) => {
      const get = vi.fn()
      for (const status of statuses) get.mockResolvedValueOnce(status)
      get.mockResolvedValue({ finished: false })
      return { get, pages: vi.fn(), send: vi.fn(() => Promise.resolve({ id: '9' })) } as unknown as WriteHttp
    }
    await cloudWriter(http({ finished: false }, { finished: true, successful: true }), pause).archive(['1'])
    expect(pause).toHaveBeenCalledTimes(1)
    await expect(
      cloudWriter(
        http({ finished: true, successful: false, messages: [{ translation: 'has children' }] }),
        pause,
      ).archive(['1']),
    ).rejects.toThrow('Archiving failed: has children')
    await expect(cloudWriter(http({ finished: true }), pause).archive(['1'])).rejects.toThrow('no reason given')
    await expect(cloudWriter(http(), pause).archive(['1'])).rejects.toThrow(
      'Archiving did not finish; check long task 9',
    )
  })

  it('passes unexpected errors through the write probes', async () => {
    const http = { get: vi.fn(), pages: vi.fn(), send: () => Promise.reject(new Error('network down')) }
    await expect(missingWriteScopes(http as unknown as WriteHttp)).rejects.toThrow('network down')
  })
})
