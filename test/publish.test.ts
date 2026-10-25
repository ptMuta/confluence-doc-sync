import { appendFile, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { files, hashFiles } from '../src/plan/bundle.ts'
import { contentHash, type DesiredPage } from '../src/plan/desired.ts'
import { sha256 } from '../src/plan/hash.ts'
import { plan } from '../src/plan/plan.ts'
import { signedMarker } from '../src/publish/marker.ts'
import { publish, type PublishOptions } from '../src/publish/publish.ts'
import { png, seeded, type FakeConfluence, type FakeItem } from './fake-confluence.ts'

interface Draft {
  [key: string]: unknown
  ops: { op: Record<string, unknown> }[]
  pages: (Record<string, unknown> & { key: string; body: { type?: string; content: unknown[] } })[]
}

const key = 'k'.repeat(32)
let root: string
let confluence: FakeConfluence
let sha: string

const bundlePath = () => join(root, 'bundle')
const connect =
  (cloudId = 'cloud') =>
  () =>
    Promise.resolve({ http: confluence.http, cloudId })

async function planned(): Promise<NonNullable<Awaited<ReturnType<typeof plan>>['outcome']>> {
  const result = await plan({
    root,
    configFile: '.docs-sync/config.yaml',
    token: 'read',
    bundlePath: bundlePath(),
    render: () => Promise.resolve(png(1600, 800)),
    env: { GITHUB_SHA: 'abc' },
    connect: connect(),
  })
  if (!result.outcome) throw new Error(JSON.stringify(result.findings))
  sha = result.outcome.sha256
  return result.outcome
}

const run = (extra: Partial<PublishOptions> = {}) =>
  publish({
    root,
    configFile: '.docs-sync/config.yaml',
    token: 'write',
    bundlePath: bundlePath(),
    expectedSha256: sha,
    tier: 'reviewed',
    ownershipKey: key,
    env: { GITHUB_SHA: 'abc', GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR: 'muta' },
    connect: connect(),
    pause: () => Promise.resolve(),
    ...extra,
  })

const errors = (findings: { severity: string; rule: string; message: string }[]) =>
  findings.filter(finding => finding.severity === 'error').map(finding => `${finding.rule}: ${finding.message}`)

async function rehash(): Promise<string> {
  const dir = bundlePath()
  return hashFiles(
    await Promise.all((await files(dir)).map(async file => [file, await readFile(join(dir, file))] as const)),
  )
}

async function tamper(change: (draft: Draft) => void): Promise<void> {
  const file = join(bundlePath(), 'plan.json')
  const draft = JSON.parse(await readFile(file, 'utf8')) as Draft
  change(draft)
  await writeFile(file, JSON.stringify(draft))
  sha = await rehash()
}

const owned = (source: string): FakeItem => {
  const item = [...confluence.items.values()].find(
    page => (page.marker as { source?: string } | undefined)?.source === source,
  )
  if (!item) throw new Error(`no page for ${source}`)
  return item
}

const source = async (file: string, change: (text: string) => string) => {
  const path = join(root, file)
  await writeFile(path, change(await readFile(path, 'utf8')))
}

async function sync(): Promise<void> {
  await planned()
  const result = await run()
  expect(errors(result.findings)).toEqual([])
}

describe('publish', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'docs-sync-publish-'))
    await cp('test/fixtures/good', root, { recursive: true })
    confluence = seeded()
  })

  it('publishes a full sync, then nothing on a re-run', async () => {
    expect((await planned()).ops).toHaveLength(9)
    const result = await run()
    expect(errors(result.findings)).toEqual([])
    expect(result.applied).toEqual({ create: 9, update: 0, move: 0, archive: 0 })

    const overview = owned('docs/overview.md')
    expect(overview.marker).toEqual({
      source: 'docs/overview.md',
      hash: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      version: 2,
      signature: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
    })
    expect(overview.labels).toEqual(['system-payments'])
    expect(overview.attachments).toEqual([expect.objectContaining({ title: 'network.png' })])
    const body = JSON.stringify(overview.body)
    const decision = owned('docs/decisions/DEC-0002-private-endpoints.md')
    expect(body).toContain(`https://example.atlassian.net/wiki/spaces/DOCS/pages/${decision.id}`)
    expect(body).toContain(`contentId-${overview.id}`)
    expect(body).toContain('\\"width\\":800')
    expect(body).not.toContain('docs-sync:')
    expect(owned('docs/requirements.yaml').parentId).toBe('123456')

    expect((await planned()).ops).toEqual([])
    confluence.writes.length = 0
    expect((await run({ tier: 'unreviewed' })).applied).toEqual({ create: 0, update: 0, move: 0, archive: 0 })
    expect(confluence.writes).toEqual([])

    await source('docs/overview.md', text => text.replace('two regions', 'three regions'))
    const update = await planned()
    expect(update.risk).toBe('low')
    expect(errors((await run({ tier: 'unreviewed' })).findings)).toEqual([])
    expect(confluence.writes.some(write => write.includes('attachment'))).toBe(false)
    expect(JSON.stringify(owned('docs/overview.md').body)).toContain('three regions')
    expect((await planned()).ops).toEqual([])
  })

  it('moves, archives and overwrites manual edits only in a reviewed tier', async () => {
    await sync()
    const overview = owned('docs/overview.md')
    owned('docs/logging.yaml').parentId = overview.id
    const monitoring = owned('docs/monitoring.yaml')
    monitoring.version = (monitoring.version ?? 0) + 1
    monitoring.labels = ['by-hand']
    confluence.add({
      id: '6000',
      type: 'page',
      title: 'Gone',
      parentId: '123456',
      version: 1,
      marker: signedMarker(key, { page: '6000', source: 'docs/gone.md', hash: 'x', version: 1 }),
    })
    const changes = await planned()
    expect(changes.ops.map(({ op }) => op.kind).sort()).toEqual(['archive', 'move', 'update'])

    confluence.writes.length = 0
    expect(errors((await run({ tier: 'unreviewed' })).findings)).toEqual([
      'publish/approval: Risky changes need the reviewed or approver tier: moves a page, overwrites a manual edit, archives a page',
    ])
    expect(confluence.writes).toEqual([])

    const result = await run()
    expect(errors(result.findings)).toEqual([])
    expect(result.applied).toEqual({ create: 0, update: 1, move: 1, archive: 1 })
    expect(owned('docs/logging.yaml').parentId).toBe('123456')
    expect(owned('docs/monitoring.yaml').labels).toEqual([])
    expect(confluence.archived).toEqual(new Set(['6000']))
    expect((await planned()).ops).toEqual([])
  })

  it('publishes into a root folder', async () => {
    confluence.add({ id: '800', type: 'folder', title: 'Documentation', parentId: '1', parentType: 'page' })
    await source('.docs-sync/config.yaml', text => text.replace('root-page: 123456', 'root-folder: 800'))
    await sync()
    expect(owned('docs/requirements.yaml').parentId).toBe('800')
    expect((await planned()).ops).toEqual([])
    await source('.docs-sync/config.yaml', text => text.replace('root-folder: 800', 'root-page: 123456'))
    expect(errors((await run()).findings)).toEqual(['publish/config: The plan does not match the config: root'])
    await source('.docs-sync/config.yaml', text =>
      text.replace('root-page: 123456', 'root-page: 1\n  root-folder: 800'),
    )
    expect(errors((await run()).findings)).toEqual([
      'schema: confluence.root-page: Set either root-page or root-folder',
    ])
  })

  it('publishes subfolders as Confluence folders', async () => {
    await mkdir(join(root, 'docs/guides/deep'), { recursive: true })
    await writeFile(join(root, 'docs/guides/setup.md'), '# Setting up\n\nInstall the action.\n')
    await writeFile(join(root, 'docs/guides/deep/notes.md'), 'Short notes.\n')
    confluence.denied.add('delete:folder:confluence')
    await planned()
    expect(errors((await run()).findings)).toEqual([
      'publish/scopes: The token is missing these scopes: delete:folder:confluence',
    ])
    confluence.denied.clear()
    expect(errors((await run({ tier: 'unreviewed' })).findings)[0]).toContain('new folder')
    await sync()

    const guides = owned('docs/guides/')
    const deep = owned('docs/guides/deep/')
    expect([guides.type, guides.title, guides.parentId]).toEqual(['folder', 'Guides', '123456'])
    expect([deep.type, deep.title, deep.parentId]).toEqual(['folder', 'Deep', guides.id])
    expect([owned('docs/guides/setup.md').title, owned('docs/guides/setup.md').parentId]).toEqual([
      'Setting up',
      guides.id,
    ])
    expect(JSON.stringify(owned('docs/guides/setup.md').body)).not.toContain('Setting up')
    expect([owned('docs/guides/deep/notes.md').title, owned('docs/guides/deep/notes.md').parentId]).toEqual([
      'Notes',
      deep.id,
    ])
    expect((await planned()).ops).toEqual([])

    await rm(join(root, 'docs/guides'), { recursive: true })
    await planned()
    await tamper(draft => {
      const op = draft.ops.find(item => item.op['folder'])
      if (op) Reflect.deleteProperty(op.op, 'folder')
    })
    expect(errors((await run()).findings)).toContainEqual(expect.stringContaining('is a folder'))
    await planned()
    const result = await run()
    expect(errors(result.findings)).toEqual([])
    expect(result.applied).toEqual({ create: 0, update: 0, move: 0, archive: 4 })
    expect(confluence.archived).toEqual(new Set([guides.id, deep.id, expect.any(String), expect.any(String)]))
    expect((await planned()).ops).toEqual([])
  })

  it('publishes diagrams as draw.io macros', async () => {
    await appendFile(join(root, '.docs-sync/config.yaml'), 'diagram-output: macro\n')
    await sync()
    const overview = owned('docs/overview.md')
    expect(overview.attachments?.map(file => file.title).sort()).toEqual(['network.drawio', 'network.drawio.png'])
    const body = JSON.stringify(overview.body)
    expect(body).toContain('/static/drawio')
    expect(body).toContain(`\\"pageId\\":\\"${overview.id}\\"`)
    expect(body).toContain('\\"diagramName\\":\\"network.drawio\\"')
    expect((await planned()).ops).toEqual([])

    await source('docs/overview.md', text => text.replace('two regions', 'three regions'))
    await planned()
    await tamper(draft => {
      const page = draft.pages.find(item => item.key === 'docs/overview.md')
      const macro = page?.body.content.find(node => (node as { type?: string }).type === 'extension') as
        { attrs: Record<string, unknown> } | undefined
      if (macro) macro.attrs['extensionKey'] = 'other'
    })
    expect(errors((await run()).findings)[0]).toContain('only draw.io macros for bundled diagrams are allowed')
  })

  it('treats deviates-from changes as risky whatever the plan says', async () => {
    await sync()
    await source('docs/decisions/DEC-0002-private-endpoints.md', text => text.replace('now available', 'available'))
    await planned()
    await tamper(draft => {
      for (const item of draft.ops) Reflect.deleteProperty(item, 'risky')
      draft['risk'] = 'low'
    })
    expect(errors((await run({ tier: 'unreviewed' })).findings)).toEqual([
      'publish/approval: Risky changes need the reviewed or approver tier: changes a page with deviates-from links',
    ])
  })

  it('refuses a bundle that is not the planned one', async () => {
    await planned()
    const refused = async (extra: Partial<PublishOptions> = {}) => errors((await run(extra)).findings)
    expect(await refused({ expectedSha256: 'A'.repeat(64) })).toEqual([
      'publish/bundle: expected-bundle-sha256 must be 64 lowercase hex characters',
    ])
    expect(await refused({ expectedSha256: '0'.repeat(64) })).toEqual([
      'publish/bundle: The bundle does not match expected-bundle-sha256',
    ])
    await writeFile(join(bundlePath(), 'extra.txt'), 'x')
    sha = await rehash()
    expect(await refused()).toEqual(['publish/bundle: The bundle files do not match the images the plan uses'])
    await rm(join(bundlePath(), 'extra.txt'))
    await rm(join(bundlePath(), 'images/network.png'))
    sha = await rehash()
    expect(await refused()).toEqual(['publish/bundle: The bundle files do not match the images the plan uses'])
    await symlink('/etc/passwd', join(bundlePath(), 'images/network.png'))
    expect(await refused()).toEqual(['publish/bundle: The bundle holds an unexpected entry: images/network.png'])
    await rm(join(bundlePath(), 'images/network.png'))
    await writeFile(join(bundlePath(), 'images/network.png'), png(1600, 800))
    await rm(join(bundlePath(), 'docs-sync.lock'))
    sha = await rehash()
    expect(await refused()).toEqual(['publish/bundle: The bundle has no plan.json or docs-sync.lock'])
  })

  it.each<[string, (draft: Draft) => void, string]>([
    ['a newer format', draft => (draft['version'] = 2), 'plan.json is malformed'],
    [
      'a foreign macro',
      draft => draft.pages[0]?.body.content.push({ type: 'extension', attrs: {} }),
      'only draw.io macros for bundled diagrams are allowed',
    ],
    ['an unknown node', draft => draft.pages[0]?.body.content.push({ type: 'bodiedExtension' }), 'not allowed'],
    [
      'another inline macro',
      draft =>
        draft.pages[0]?.body.content.push({
          type: 'paragraph',
          content: [{ type: 'inlineExtension', attrs: { extensionKey: 'html' } }],
        }),
      'only anchor macros are allowed',
    ],
    [
      'a script link',
      draft =>
        draft.pages[0]?.body.content.push({
          type: 'paragraph',
          content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
        }),
      'a link is not https or a page link',
    ],
    [
      'an unknown mark',
      draft =>
        draft.pages[0]?.body.content.push({
          type: 'paragraph',
          content: [{ type: 'text', text: 'x', marks: [{ type: 'textColor' }] }],
        }),
      'a mark is not allowed',
    ],
    [
      'malformed marks',
      draft => draft.pages[0]?.body.content.push({ type: 'paragraph', marks: 'strong' }),
      'has malformed marks',
    ],
    [
      'a foreign image',
      draft =>
        draft.pages[0]?.body.content.push({
          type: 'media',
          attrs: { type: 'file', id: 'other', collection: 'docs-sync:collection' },
        }),
      'a media node does not point at a bundled image',
    ],
    ['extra fields', draft => draft.pages[0]?.body.content.push({ type: 'paragraph', html: '<b>' }), 'unknown fields'],
    ['bad attrs', draft => draft.pages[0]?.body.content.push({ type: 'paragraph', attrs: [] }), 'malformed attrs'],
    ['stray text', draft => draft.pages[0]?.body.content.push({ type: 'paragraph', text: 'x' }), 'malformed text'],
    [
      'bad content',
      draft => draft.pages[0]?.body.content.push({ type: 'paragraph', content: {} }),
      'malformed content',
    ],
    ['a malformed node', draft => draft.pages[0]?.body.content.push('text'), 'a page body node is malformed'],
    [
      'deep nesting',
      draft => {
        let node: Record<string, unknown> = { type: 'paragraph' }
        for (let depth = 0; depth < 70; depth++) node = { type: 'listItem', content: [node] }
        draft.pages[0]?.body.content.push(node)
      },
      'nested too deeply',
    ],
    [
      'a body that is not a document',
      draft => {
        const page = draft.pages[0]
        if (page) page.body = { type: 'paragraph', content: [] }
      },
      'the body is not a document',
    ],
  ])('refuses a plan with %s', async (_name, change, message) => {
    await planned()
    await tamper(change)
    const [refusal = ''] = errors((await run()).findings)
    expect(refusal).toMatch(/^publish\/bundle: /)
    expect(refusal).toContain(message)
    expect(confluence.writes).toEqual([])
  })

  it('refuses plans for another commit, branch or config', async () => {
    await planned()
    expect(errors((await run({ env: { GITHUB_SHA: 'def', GITHUB_REF: 'refs/heads/main' } })).findings)).toEqual([
      'publish/commit: The plan is for abc, not def; plan again',
    ])
    expect(errors((await run({ env: { GITHUB_SHA: 'abc', GITHUB_REF: 'refs/heads/feature' } })).findings)).toEqual([
      'publish/branch: Publish runs only on main, not refs/heads/feature',
    ])
    await tamper(draft => (draft['approval'] = 'none'))
    expect(errors((await run()).findings)).toEqual(['publish/config: The plan does not match the config: approval'])
    await tamper(draft => {
      draft['approval'] = 'on-risk'
      draft['space'] = { key: 'DOCS', id: 'space-OTHER' }
    })
    expect(errors((await run()).findings)).toEqual(['publish/space: Space DOCS is not the space in the plan'])
    await tamper(draft => Reflect.deleteProperty(draft, 'commit'))
    expect(errors((await run()).findings)).toEqual(['publish/commit: The plan is for no commit, not abc; plan again'])
  })

  it('checks the tier, key and approvers', async () => {
    await planned()
    expect(errors((await run({ tier: 'admin' })).findings)).toEqual([
      'publish/tier: environment-tier must be one of: unreviewed, reviewed, approver',
    ])
    expect(errors((await run({ ownershipKey: 'short' })).findings)).toEqual([
      'publish/key: ownership-key must be at least 32 characters',
    ])
    expect(errors((await run({ tier: 'approver' })).findings)).toEqual(['publish/approval: muta is not in approvers'])
    expect(
      errors((await run({ tier: 'approver', env: { GITHUB_SHA: 'abc', GITHUB_REF: 'refs/heads/main' } })).findings),
    ).toEqual(['publish/approval: The user who started this run is not in approvers'])
    await appendFile(join(root, '.docs-sync/config.yaml'), 'approvers: [Muta]\nself-approval: false\n')
    expect(errors((await run({ tier: 'approver' })).findings)).toEqual([
      'publish/approval: change-author is needed when self-approval is false',
    ])
    expect(errors((await run({ tier: 'approver', author: 'MUTA' })).findings)).toEqual([
      'publish/approval: muta cannot approve their own change',
    ])
    const result = await run({ tier: 'approver', author: 'someone' })
    expect(errors(result.findings)).toEqual([])
    expect(result.applied?.create).toBe(9)
  })

  it('needs a reviewed tier for every change when approval is always', async () => {
    await appendFile(join(root, '.docs-sync/config.yaml'), 'approval: always\n')
    await planned()
    expect(errors((await run({ tier: 'unreviewed' })).findings)).toEqual([
      'publish/approval: approval: always needs the reviewed or approver tier',
    ])
    await writeFile(join(root, '.docs-sync/config.yaml'), 'broken: [')
    expect(errors((await run()).findings)).not.toEqual([])
  })

  it('checks the site, scopes and visibility again', async () => {
    await planned()
    expect(errors((await run({ connect: connect('other') })).findings)).toEqual([
      'publish/site: The site cloud id changed since the plan',
    ])
    confluence.denied.add('write:label:confluence')
    expect(errors((await run()).findings)).toEqual([
      'publish/scopes: The token is missing these scopes: write:label:confluence',
    ])
    confluence.denied.clear()
    const home = confluence.items.get('123456')
    if (home) home.readers = ['group:g1']
    expect(errors((await run()).findings)).toEqual([
      'publish/visibility: Who can view the root changed since the plan; plan again',
    ])
    confluence.access = [{ principalType: 'ACCESS_CLASS', principalId: 'anonymous-users' }]
    expect(errors((await run()).findings)[0]).toMatch(/^visibility\/space/)
    expect(confluence.writes).toEqual([])
  })

  it('only touches signed pages under the root that match the plan', async () => {
    await sync()
    await source('docs/overview.md', text => text.replace('two regions', 'three regions'))
    await planned()
    confluence.writes.length = 0
    const overview = owned('docs/overview.md')
    const refused = async () => errors((await run()).findings)

    overview.marker = { ...(overview.marker as object), signature: 'f'.repeat(64) }
    expect(await refused()).toEqual([
      `publish/op: update docs/overview.md: page ${overview.id} has no valid ownership signature`,
    ])
    overview.marker = signedMarker(key, {
      page: overview.id,
      source: 'docs/overview.md',
      hash: (overview.marker as { hash: string }).hash,
      version: overview.version ?? 0,
    })
    overview.version = (overview.version ?? 0) + 1
    expect(await refused()).toEqual([
      `publish/op: update docs/overview.md: page ${overview.id} was edited in Confluence after the plan; plan again`,
    ])
    overview.version = (overview.version ?? 0) - 1

    const original = await readFile(join(bundlePath(), 'plan.json'), 'utf8')
    const variant = async (change: (draft: Draft) => void) => {
      await writeFile(join(bundlePath(), 'plan.json'), original)
      await tamper(change)
      return refused()
    }
    const update = (draft: Draft) => draft.ops[0]?.op ?? {}
    expect(await variant(draft => (update(draft)['page'] = '1'))).toEqual([
      'publish/op: update docs/overview.md: page 1 does not hold this source under the root',
    ])
    expect(await variant(draft => (update(draft)['title'] = 'Other'))).toEqual([
      'publish/op: update docs/overview.md: the title does not match the page',
    ])
    expect(await variant(draft => draft.ops.push({ op: { ...update(draft) } }))).toEqual([
      'publish/op: The plan lists a change or a page twice',
      'publish/op: The plan pages do not match its creates and updates',
    ])
    expect(await variant(draft => draft.pages[0] && (draft.pages[0]['hash'] = '0'))).toEqual([
      'publish/op: Page docs/overview.md: the content does not match its hash',
    ])
    expect(
      await variant(draft => {
        draft.ops = [
          { op: { kind: 'create', key: 'docs/overview.md', title: 'Payments overview', parent: { page: '1' } } },
        ]
      }),
    ).toEqual([
      `publish/op: create docs/overview.md: page ${overview.id} already holds this source`,
      'publish/op: create docs/overview.md: the parent is not the root or a page this tool owns',
    ])
    expect(
      await variant(draft =>
        draft.ops.push(
          { op: { kind: 'archive', key: 'docs/overview.md', page: overview.id, title: 'x' } },
          {
            op: {
              kind: 'move',
              key: 'docs/logging.yaml',
              page: owned('docs/logging.yaml').id,
              from: '1',
              to: { key: 'x' },
            },
          },
        ),
      ),
    ).toEqual([
      'publish/op: archive docs/overview.md: the plan also writes this page',
      'publish/op: move docs/logging.yaml: the new parent is not the root or a page this tool owns',
    ])
    expect(confluence.writes).toEqual([])
  })

  it('stops on pages whose parents never appear and on links to unknown pages', async () => {
    await planned()
    await tamper(draft => {
      const [first, second] = draft.ops
      if (first && second) {
        first.op['parent'] = { key: second.op['key'] }
        second.op['parent'] = { key: first.op['key'] }
      }
    })
    await expect(run()).rejects.toThrow('New pages wait on parents that are never created')
    await planned()
    const image = { sha256: sha256(await readFile(join(bundlePath(), 'images/network.png'))) }
    await tamper(draft => {
      const page = draft.pages.find(item => item.key === 'docs/overview.md')
      if (!page) return
      page.body.content.push({
        type: 'paragraph',
        content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'docs-sync:page/nope.md' } }] }],
      })
      page['hash'] = contentHash(page as unknown as DesiredPage, new Map([['network.png', image]]))
    })
    await expect(run()).rejects.toThrow('A link points at nope.md, which has no page')
  })
})
