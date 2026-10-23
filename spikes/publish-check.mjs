import { spawnSync } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { appendFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const env = name => {
  const value = process.env[name]
  if (!value) throw new Error(`missing ${name}`)
  return value
}

const site = env('CONFLUENCE_SITE')
const space = env('CONFLUENCE_TEST_SPACE')
const eaSpace = env('CONFLUENCE_EA_SPACE')
const eaFolder = env('CONFLUENCE_EA_FOLDER')
const R = env('CONFLUENCE_SPIKE_READ_TOKEN')
const W = env('CONFLUENCE_SPIKE_WRITE_TOKEN')
const image = process.env.DOCS_SYNC_IMAGE ?? 'docs-sync:spike'
const run = process.env.GITHUB_RUN_ID ?? String(Date.now())
const key = randomBytes(32).toString('hex')
const main = resolve('dist/main.mjs')
const summary = []
const say = line => {
  console.log(line)
  summary.push(line)
}

const cloud = (await (await fetch(`https://${site}/_edge/tenant_info`, { redirect: 'error' })).json()).cloudId
const base = `https://api.atlassian.com/ex/confluence/${cloud}/wiki`

async function call(token, method, path, json) {
  const res = await fetch(base + path, {
    method,
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    },
    body: json ? JSON.stringify(json) : undefined,
  })
  const text = await res.text()
  if (res.status >= 300) throw new Error(`${method} ${path.split('?')[0]}: ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

const adf = text => ({
  representation: 'atlas_doc_format',
  value: JSON.stringify({
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }),
})

const dst = (await call(R, 'GET', `/api/v2/spaces?keys=${space}`)).results[0]
const page = id => call(R, 'GET', `/api/v2/pages/${id}?body-format=atlas_doc_format`)
const props = async id => (await call(R, 'GET', `/api/v2/pages/${id}/properties?key=docs-sync`)).results[0]
const sign = (id, source, hash, version) => ({
  source,
  hash,
  version,
  signature: createHmac('sha256', key)
    .update(JSON.stringify({ hash, page: id, source, version }))
    .digest('hex'),
})
const setMarker = async (id, value) => {
  const current = await props(id)
  if (current)
    await call(W, 'PUT', `/api/v2/pages/${id}/properties/${current.id}`, {
      key: 'docs-sync',
      value,
      version: { number: current.version.number + 1 },
    })
  else await call(W, 'POST', `/api/v2/pages/${id}/properties`, { key: 'docs-sync', value })
}
const edit = async (id, changes) => {
  const current = await page(id)
  await call(W, 'PUT', `/api/v2/pages/${id}`, {
    id,
    status: 'current',
    title: current.title,
    body: adf('edited by hand'),
    version: { number: current.version.number + 1 },
    ...changes,
  })
}

const cql = q => call(R, 'GET', `/rest/api/content/search?cql=${encodeURIComponent(q)}&limit=50`)
const [folderName] = eaFolder.split('/')
const folder = (await cql(`space="${eaSpace}" and type=folder and title="${folderName}"`)).results[0]
const ref = (await cql(`space="${eaSpace}" and type=page and ancestor=${folder.id}`)).results
  .map(result => /^ADR-\d{3,4}(?![\w-])/.exec(result.title)?.[0])
  .find(Boolean)
if (!ref) throw new Error(`no ADR-NNN page under ${eaFolder}`)

const root = (
  await call(W, 'POST', '/api/v2/pages', {
    spaceId: dst.id,
    status: 'current',
    title: `docs-sync publish check ${run}`,
    parentId: dst.homepageId,
    body: adf('sandbox'),
  })
).id
const repo = mkdtempSync(join(tmpdir(), 'publish-check-'))
cpSync('test/fixtures/good', repo, { recursive: true })
for (const file of readdirSync(join(repo, 'docs'), { recursive: true }).map(name => join(repo, 'docs', name))) {
  if (!/\.(md|yaml)$/.test(file)) continue
  writeFileSync(
    file,
    readFileSync(file, 'utf8')
      .replace(/ea:ADR-\d+/g, `ea:${ref}`)
      .replace(/^title: (.*)$/m, `title: $1 ${run}`),
  )
}
writeFileSync(
  join(repo, '.docs-sync/config.yaml'),
  `system: Publish check ${run}
confluence:
  site: ${site}
  space: ${space}
  root-page: ${root}
approvers: [docs-approver]
tags:
  vocabulary: shared/tags.yaml
reference-sources:
  ea:
    type: confluence
    space: ${eaSpace}
    folder: ${eaFolder}
    id-pattern: 'ADR-\\d{3,4}'
`,
)

const notable = output => output.split('\n').filter(line => /::(error|warning)|Plan [0-9a-f]{64}|Published:/.test(line))

function plan(label) {
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${repo}:/github/workspace`,
      '-w',
      '/github/workspace',
      '-e',
      'INPUT_MODE=plan',
      '-e',
      'INPUT_CONFLUENCE-TOKEN',
      '-e',
      'INPUT_BUNDLE-PATH=bundle',
      '-e',
      'GITHUB_SHA=spike',
      image,
    ],
    { encoding: 'utf8', env: { PATH: process.env.PATH, 'INPUT_CONFLUENCE-TOKEN': R } },
  )
  const output = `${result.stdout}${result.stderr}`
  say(`\n### ${label}\n\n\`\`\`\n${notable(output).join('\n')}\n\`\`\``)
  if (result.status !== 0) throw new Error(`${label} failed`)
  return {
    sha: /Plan ([0-9a-f]{64})/.exec(output)?.[1],
    plan: JSON.parse(readFileSync(join(repo, 'bundle/plan.json'), 'utf8')),
  }
}

function publish(label, sha, tier, extra = {}) {
  const result = spawnSync('node', [main], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      INPUT_MODE: 'publish',
      'INPUT_CONFLUENCE-TOKEN': W,
      'INPUT_BUNDLE-PATH': join(repo, 'bundle'),
      'INPUT_EXPECTED-BUNDLE-SHA256': sha,
      'INPUT_ENVIRONMENT-TIER': tier,
      'INPUT_OWNERSHIP-KEY': key,
      GITHUB_SHA: 'spike',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_ACTOR: 'docs-bot',
      ...extra,
    },
  })
  const lines = notable(`${result.stdout}${result.stderr}`)
  say(`\n### ${label}\n\n\`\`\`\n${lines.join('\n')}\n\`\`\``)
  return { ok: result.status === 0, errors: lines.filter(line => line.startsWith('::error')).join('\n') }
}

const kinds = plan =>
  plan.ops
    .map(
      ({ op, risky }) => `${op.kind}${op.changes ? `(${op.changes.join('+')})` : ''}${risky ? ' risky' : ''} ${op.key}`,
    )
    .sort()
const expect = (name, actual, wanted) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  say(
    `- ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)}`}`,
  )
  if (!ok) process.exitCode = 1
}
const refused = (name, result, text) => expect(name, !result.ok && result.errors.includes(text), true)

const tree = async () => (await call(R, 'GET', `/api/v2/pages/${root}/descendants?limit=250`)).results
const versions = async () =>
  (await Promise.all((await tree()).map(async item => `${item.id}:${(await page(item.id)).version.number}`))).sort()
const owned = async () => {
  const pages = new Map()
  for (const item of await tree()) {
    const marker = (await props(item.id))?.value
    if (marker?.source) pages.set(marker.source, { id: item.id, marker })
  }
  return pages
}

let failed = false
try {
  const first = plan('First plan')
  expect('first plan creates every page', [...new Set(first.plan.ops.map(({ op }) => op.kind))], ['create'])
  cpSync(join(repo, 'bundle/docs-sync.lock'), join(repo, '.docs-sync/docs-sync.lock'))

  refused('unreviewed tier refuses new pages', publish('Publish, unreviewed', first.sha, 'unreviewed'), 'Risky changes')
  refused('approver tier needs an approver', publish('Publish, approver', first.sha, 'approver'), 'not in approvers')
  refused('wrong hash is refused', publish('Publish, wrong hash', '0'.repeat(64), 'reviewed'), 'does not match')
  expect('refusals wrote nothing', (await tree()).length, 0)

  expect('full sync', publish('Publish, reviewed', first.sha, 'reviewed').ok, true)
  const pages = await owned()
  expect(
    'every page is created and signed',
    [...pages.values()].filter(p => p.marker.signature).length,
    first.plan.pages.length,
  )
  const overview = pages.get('docs/overview.md')
  const overviewPage = await page(overview.id)
  const attachments = (await call(R, 'GET', `/api/v2/pages/${overview.id}/attachments`)).results
  expect(
    'diagram uploaded',
    attachments.map(a => a.title),
    ['network.png'],
  )
  const body = overviewPage.body.atlas_doc_format.value
  expect('image points at the upload', body.includes(attachments[0]?.fileId ?? 'none'), true)
  expect('links point at pages', body.includes(`/wiki/spaces/${space}/pages/`), true)
  expect('no placeholders left', body.includes('docs-sync:'), false)
  say(`\nOverview: https://${site}/wiki/spaces/${space}/pages/${overview.id}`)

  const quiet = plan('Plan after publish')
  expect('nothing to do after publish', quiet.plan.ops, [])
  const snapshot = await versions()
  expect('empty publish', publish('Publish, nothing to do', quiet.sha, 'unreviewed').ok, true)
  expect('empty publish wrote nothing', await versions(), snapshot)

  const overviewFile = join(repo, 'docs/overview.md')
  writeFileSync(overviewFile, readFileSync(overviewFile, 'utf8').replace('two regions', 'three regions'))
  const content = plan('Plan after a source change')
  expect('content change is a low-risk update', kinds(content.plan), ['update(content) docs/overview.md'])
  const attachmentVersion = attachments[0]?.version?.number
  expect('content change publishes unreviewed', publish('Publish content change', content.sha, 'unreviewed').ok, true)
  const after = (await call(R, 'GET', `/api/v2/pages/${overview.id}/attachments`)).results
  expect('unchanged diagram is not uploaded again', after[0]?.version?.number, attachmentVersion)

  writeFileSync(overviewFile, readFileSync(overviewFile, 'utf8').replace('three regions', 'four regions'))
  const unsigned = plan('Plan for the unsigned page')
  const marker = (await props(overview.id)).value
  await setMarker(overview.id, { ...marker, signature: undefined })
  refused(
    'unsigned page is refused',
    publish('Publish to an unsigned page', unsigned.sha, 'reviewed'),
    'no valid ownership signature',
  )
  await setMarker(overview.id, marker)
  await edit(overview.id, {})
  refused(
    'edit after plan is refused',
    publish('Publish after a manual edit', unsigned.sha, 'reviewed'),
    'edited in Confluence after the plan',
  )

  const logging = pages.get('docs/logging.yaml')
  await call(W, 'PUT', `/rest/api/content/${logging.id}/move/append/${overview.id}`)
  const moved = await page(logging.id)
  await setMarker(
    logging.id,
    sign(logging.id, 'docs/logging.yaml', (await props(logging.id)).value.hash, moved.version.number),
  )
  const gone = (
    await call(W, 'POST', '/api/v2/pages', {
      spaceId: dst.id,
      status: 'current',
      title: `Gone ${run}`,
      parentId: root,
      body: adf('gone'),
    })
  ).id
  await setMarker(gone, sign(gone, 'docs/gone.md', 'x', 1))
  const risky = plan('Plan with risky changes')
  expect('risky changes', kinds(risky.plan), [
    'archive risky docs/gone.md',
    'move risky docs/logging.yaml',
    'update(content+manual-edit) risky docs/overview.md',
  ])
  refused(
    'unreviewed tier refuses risky changes',
    publish('Publish risky, unreviewed', risky.sha, 'unreviewed'),
    'Risky changes',
  )
  expect(
    'approver publishes risky changes',
    publish('Publish risky, approver', risky.sha, 'approver', { GITHUB_ACTOR: 'docs-approver' }).ok,
    true,
  )
  expect('logging moved back', (await page(logging.id)).parentId, root)
  expect('gone archived', (await call(R, 'GET', `/api/v2/pages/${gone}`)).status, 'archived')

  const final = plan('Final plan')
  expect('nothing to do at the end', final.plan.ops, [])
} catch (cause) {
  failed = true
  say(`\nStopped: ${cause.message}`)
} finally {
  const all = await tree().catch(() => [])
  const ids = [root, ...all.filter(item => item.type === 'page').map(item => item.id)]
  await call(W, 'POST', '/rest/api/content/archive', { pages: ids.map(id => ({ id: Number(id) })) }).catch(cause =>
    say(`\nCleanup failed: ${cause.message}`),
  )
  appendFileSync(process.env.GITHUB_STEP_SUMMARY ?? '/dev/null', `## Publish check\n${summary.join('\n')}\n`)
  if (failed) process.exitCode = 1
}
