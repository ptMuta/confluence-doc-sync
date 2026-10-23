import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { plan, type PlanOptions } from '../src/plan/plan.ts'
import type { Plan } from '../src/plan/bundle.ts'
import { png, seeded, type FakeConfluence } from './fake-confluence.ts'

let root: string
let confluence: FakeConfluence

const options = (extra: Partial<PlanOptions> = {}): PlanOptions => ({
  root,
  configFile: '.docs-sync/config.yaml',
  token: 'token',
  bundlePath: join(root, 'bundle'),
  render: () => Promise.resolve(png(1600, 800)),
  env: { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'acme/payments', GITHUB_SHA: 'abc' },
  connect: () => Promise.resolve({ http: confluence.http, cloudId: 'cloud' }),
  ...extra,
})

const rules = (findings: { rule: string; severity: string }[], severity = 'error') =>
  findings.filter(finding => finding.severity === severity).map(finding => finding.rule)

const config = async (change: (text: string) => string) => {
  const file = join(root, '.docs-sync/config.yaml')
  await writeFile(file, change(await readFile(file, 'utf8')))
}

const bundle = async (): Promise<Plan> => JSON.parse(await readFile(join(root, 'bundle/plan.json'), 'utf8')) as Plan

async function publishAll(): Promise<Plan> {
  const first = await bundle()
  let next = 5000
  const ids = new Map<string, string>()
  for (const page of first.pages) ids.set(page.key, String(next++))
  for (const page of first.pages)
    confluence.add({
      id: ids.get(page.key) ?? '',
      type: 'page',
      title: page.title,
      parentId: page.parent ? (ids.get(page.parent) ?? '') : '123456',
      parentType: 'page',
      version: 3,
      marker: { source: page.key, hash: page.hash, version: 3 },
    })
  return first
}

describe('plan', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'docs-sync-plan-'))
    await cp('test/fixtures/good', root, { recursive: true })
    confluence = seeded()
  })

  it('creates every page on the first run and writes a stable bundle', async () => {
    const first = await plan(options())
    expect(rules(first.findings)).toEqual([])
    expect(rules(first.findings, 'warning')).toContain('refs/lock')
    expect(first.outcome?.risk).toBe('high')
    expect(first.outcome?.lockChanged).toBe(true)
    expect(first.outcome?.ops.map(({ op }) => op.kind)).toEqual(Array(9).fill('create'))
    const written = await bundle()
    expect(written.space).toEqual({ key: 'DOCS', id: 'space-DOCS' })
    expect(JSON.stringify(written.pages)).toContain('docs-sync:page/docs%2Fdecisions%2FDEC-0002-private-endpoints.md')
    expect(JSON.stringify(written.pages)).toContain('https://github.com/acme/payments/blob/abc/policy/no-secrets.rego')
    expect(await readFile(join(root, 'bundle/images/network.png'))).toEqual(png(1600, 800))
    const lock = await readFile(join(root, 'bundle/docs-sync.lock'), 'utf8')
    expect(JSON.parse(lock)).toEqual({
      version: 1,
      refs: {
        'ea:ADR-007': { page: '7', state: 'superseded' },
        'ea:ADR-012': { page: '12' },
        'ea:ADR-031': { page: '31' },
      },
    })
    const again = await plan(options())
    expect(again.outcome?.sha256).toBe(first.outcome?.sha256)
    expect(confluence.calls.every(path => !path.includes('/rest/api/content/') || path.includes('/search'))).toBe(true)
  })

  it('plans nothing when Confluence matches, then updates, moves, archives and flags manual edits', async () => {
    await plan(options())
    await writeFile(join(root, '.docs-sync/docs-sync.lock'), await readFile(join(root, 'bundle/docs-sync.lock')))
    const published = await publishAll()
    const quiet = await plan(options())
    expect(rules(quiet.findings, 'warning')).toEqual(['refs/state'])
    expect(quiet.outcome?.ops).toEqual([])
    expect(quiet.outcome?.risk).toBe('low')
    expect(quiet.outcome?.lockChanged).toBe(false)

    const byKey = (key: string) =>
      [...confluence.items.values()].find(item => (item.marker as { source?: string } | undefined)?.source === key)
    const overview = byKey('docs/overview.md')
    const logging = byKey('docs/logging.yaml')
    const monitoring = byKey('docs/monitoring.yaml')
    if (!overview || !logging || !monitoring) throw new Error('missing seeded pages')
    overview.marker = { source: 'docs/overview.md', hash: 'old', version: 3 }
    logging.parentId = overview.id
    monitoring.version = 4
    confluence.add({
      id: '6000',
      type: 'page',
      title: 'Gone',
      parentId: '123456',
      version: 1,
      marker: { source: 'docs/gone.md', hash: 'x', version: 1 },
    })
    const result = await plan(options())
    expect(rules(result.findings, 'warning').sort()).toEqual(['plan/manual-edit', 'refs/state'])
    expect(result.outcome?.ops).toEqual(
      expect.arrayContaining([
        {
          op: {
            kind: 'update',
            key: 'docs/overview.md',
            page: overview.id,
            title: 'Payments overview',
            changes: ['content'],
          },
        },
        {
          op: {
            kind: 'update',
            key: 'docs/monitoring.yaml',
            page: monitoring.id,
            title: 'Payments: Monitoring use cases',
            changes: ['manual-edit'],
          },
          risky: 'overwrites a manual edit',
        },
        {
          op: { kind: 'move', key: 'docs/logging.yaml', page: logging.id, from: overview.id, to: { page: '123456' } },
          risky: 'moves a page',
        },
        { op: { kind: 'archive', key: 'docs/gone.md', page: '6000', title: 'Gone' }, risky: 'archives a page' },
      ]),
    )
    expect(result.outcome?.ops).toHaveLength(4)
    expect((await bundle()).pages.map(page => page.key).sort()).toEqual(['docs/monitoring.yaml', 'docs/overview.md'])
    expect(published.pages).toHaveLength(9)
  })

  it('names every missing scope before reading anything else', async () => {
    confluence.denied.add('read:hierarchical-content:confluence')
    confluence.denied.add('search:confluence')
    const result = await plan(options())
    expect(result.findings.at(-1)?.message).toBe(
      'The token is missing these scopes: read:hierarchical-content:confluence, search:confluence',
    )
    confluence.denied.clear()
    confluence.denied.add('read:space.permission:confluence')
    expect((await plan(options())).findings.at(-1)?.message).toContain('read:space.permission:confluence')
  })

  it('refuses spaces open to anonymous users unless visibility is public', async () => {
    confluence.access = [{ principalType: 'ACCESS_CLASS', principalId: 'anonymous-users' }]
    expect(rules((await plan(options())).findings)).toEqual(['visibility/space'])
    await config(text => text.replace('root-page: 123456', 'root-page: 123456\n  visibility: public'))
    expect(rules((await plan(options())).findings)).toEqual([])
  })

  it('needs a read restriction and the expected readers when restricted', async () => {
    await config(text => text.replace('root-page: 123456', 'root-page: 123456\n  visibility: restricted'))
    expect(rules((await plan(options())).findings)).toEqual(['visibility/restricted'])
    await config(text => text.replace('visibility: restricted', 'visibility: restricted\n  readers: [payments-team]'))
    const home = confluence.items.get('1')
    if (home) home.readers = ['group:g1', 'user:u1']
    confluence.groups = { g1: 'everyone' }
    const wrong = (await plan(options())).findings.find(finding => finding.rule === 'visibility/readers')
    expect(wrong?.message).toBe('page 1 lets everyone view it; expected payments-team')
    confluence.groups = { g1: 'payments-team' }
    expect(rules((await plan(options())).findings)).toEqual([])
    expect((await bundle()).visibility.chain.map(level => level.readers)).toEqual([[], ['group:g1', 'user:u1']])
  })

  it('fails when a locked reference moves to another page', async () => {
    await writeFile(
      join(root, '.docs-sync/docs-sync.lock'),
      JSON.stringify({
        version: 1,
        refs: {
          'ea:ADR-012': { page: '99' },
          'ea:ADR-031': { page: '31', state: 'draft' },
          'ea:ADR-001': { page: '1' },
        },
      }),
    )
    const findings = (await plan(options())).findings.filter(finding => finding.rule === 'refs/lock')
    expect(findings.map(finding => [finding.severity, finding.message])).toEqual([
      ['warning', 'ea:ADR-007 is not in .docs-sync/docs-sync.lock yet; commit the lock file from the plan bundle'],
      ['error', 'ea:ADR-012 now points at page 12, but .docs-sync/docs-sync.lock pins page 99'],
      ['warning', 'ea:ADR-031 changed from draft to no state'],
      ['warning', 'ea:ADR-001 is no longer used; commit the lock file from the plan bundle'],
    ])
    await writeFile(join(root, '.docs-sync/docs-sync.lock'), 'nope')
    expect(rules((await plan(options())).findings)).toEqual(['refs/lock'])
  })

  it('reports references it cannot resolve', async () => {
    confluence.add({ id: '13', type: 'page', title: 'ADR-012 copy', parentId: '901', space: 'ARCH' })
    confluence.items.delete('31')
    const messages = (await plan(options())).findings
      .filter(finding => finding.rule === 'refs/resolve')
      .map(finding => finding.message)
    expect(messages).toEqual(['ea:ADR-012 matches 2 pages (12, 13) in ARCH', 'ea:ADR-031 not found in ARCH'])
    confluence.items.delete('901')
    expect((await plan(options())).findings.at(-1)?.message).toBe(
      'Folder "Architecture/External decisions" in ARCH was not found',
    )
  })

  it('finds references by label and refuses page-property matching', async () => {
    await config(text => text.replace("id-pattern: 'ADR-\\d{3,4}'", "id-pattern: 'ADR-\\d{3,4}'\n    match: label"))
    for (const id of ['7', '12', '31']) {
      const item = confluence.items.get(id)
      if (item) item.labels = [`adr-${id.padStart(3, '0')}`]
    }
    expect(rules((await plan(options())).findings)).toEqual([])
    await config(text => text.replace('match: label', 'match: page-property'))
    expect(rules((await plan(options())).findings)).toEqual(['refs/match'])
  })

  it('refuses two sources with one title', async () => {
    await writeFile(join(root, 'docs/copy.md'), '---\ntitle: Payments overview\n---\n\nSee [[DEC-0002]].\n')
    const findings = (await plan(options())).findings.filter(finding => finding.rule === 'plan/title')
    expect(findings.map(finding => finding.message)).toEqual(['Title "Payments overview" is also used by docs/copy.md'])
  })

  it('refuses titles another page in the space already uses', async () => {
    confluence.add({ id: '777', type: 'page', title: 'Payments overview', parentId: '1' })
    const result = await plan(options())
    expect(result.findings.at(-1)?.message).toBe('Page 777 in the space already has the title "Payments overview"')
    expect(result.outcome).toBeUndefined()
  })

  it('stops early on setup problems', async () => {
    expect((await plan(options({ render: undefined }))).findings.at(-1)?.rule).toBe('plan/render')
    await config(text => text.replace('root-page: 123456', 'root-page: 42'))
    expect((await plan(options())).findings.at(-1)?.rule).toBe('plan/root')
    await config(text => text.replace('space: DOCS', 'space: NOPE'))
    expect((await plan(options())).findings.at(-1)?.rule).toBe('plan/space')
    await config(() => 'system: x\n')
    expect(rules((await plan(options())).findings)).toEqual(['schema'])
  })

  it('checks the cloud id pin before reading', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ cloudId: '0bd2ba39-2a5c-4e4b-9e8a-2f7f0c2d1a10' })))),
    )
    await config(text =>
      text.replace('root-page: 123456', 'root-page: 123456\n  cloud-id: 11111111-2222-4333-8444-555555555555'),
    )
    await expect(plan({ ...options(), connect: undefined })).rejects.toThrow(
      'has cloud id 0bd2ba39-2a5c-4e4b-9e8a-2f7f0c2d1a10, but the config pins',
    )
    vi.unstubAllGlobals()
  })
})
