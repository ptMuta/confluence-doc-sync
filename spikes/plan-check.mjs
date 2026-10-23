import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
const run = process.env.GITHUB_RUN_ID ?? String(Date.now())
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
const create = async (title, parentId) =>
  (await call(W, 'POST', '/api/v2/pages', { spaceId: dst.id, status: 'current', title, parentId, body: adf(title) })).id
const mark = (id, value) => call(W, 'POST', `/api/v2/pages/${id}/properties`, { key: 'docs-sync', value })
const page = id => call(R, 'GET', `/api/v2/pages/${id}`)
const update = async (id, changes) => {
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
const decisions = (await cql(`space="${eaSpace}" and type=page and ancestor=${folder.id}`)).results
  .map(result => /^ADR-\d{3,4}(?![\w-])/.exec(result.title)?.[0])
  .filter(Boolean)
const ref = decisions[0]
if (!ref) throw new Error(`no ADR-NNN page under ${eaFolder}`)

const root = await create(`docs-sync plan check ${run}`, dst.homepageId)
const repo = mkdtempSync(join(tmpdir(), 'plan-check-'))
cpSync('test/fixtures/good', repo, { recursive: true })
for (const file of readdirSync(join(repo, 'docs'), { recursive: true }).map(name => join(repo, 'docs', name))) {
  if (!/\.(md|yaml)$/.test(file)) continue
  writeFileSync(
    file,
    readFileSync(file, 'utf8')
      .replace(/ea:ADR-\d+/g, `ea:${ref}`)
      .replace(/^!\[.*\.drawio.*$/m, '')
      .replace(/^title: (.*)$/m, `title: $1 ${run}`),
  )
}
rmSync(join(repo, 'docs/diagrams'), { recursive: true })
writeFileSync(
  join(repo, '.docs-sync/config.yaml'),
  `system: Plan check ${run}
confluence:
  site: ${site}
  space: ${space}
  root-page: ${root}
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

function plan(label) {
  const bundle = join(repo, 'bundle')
  const result = spawnSync('node', [main], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      INPUT_MODE: 'plan',
      'INPUT_CONFLUENCE-TOKEN': R,
      'INPUT_BUNDLE-PATH': bundle,
    },
  })
  const lines = `${result.stdout}${result.stderr}`
    .split('\n')
    .filter(line => /::(error|warning)|Plan [0-9a-f]{64}|Docs plan/.test(line))
  say(`\n### ${label}\n\n\`\`\`\n${lines.join('\n')}\n\`\`\``)
  if (result.status !== 0) return undefined
  return JSON.parse(readFileSync(join(bundle, 'plan.json'), 'utf8'))
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

let failed = false
try {
  const first = plan('First plan')
  if (!first) throw new Error('first plan failed')
  say(
    `\nSpace open to: ${first.visibility.openTo.join(', ') || 'nobody outside the space'}; chain: ${first.visibility.chain.map(level => `${level.type} ${level.id} [${level.readers.join(' ')}]`).join(' > ')}`,
  )
  expect('first plan creates every page', [...new Set(first.ops.map(({ op }) => op.kind))], ['create'])
  cpSync(join(repo, 'bundle/docs-sync.lock'), join(repo, '.docs-sync/docs-sync.lock'))

  const ids = new Map()
  for (const desired of first.pages) {
    const parent = desired.parent ? ids.get(desired.parent) : root
    const id = await create(desired.title, parent)
    ids.set(desired.key, id)
    await mark(id, { source: desired.key, hash: desired.hash, version: (await page(id)).version.number })
  }
  const quiet = plan('Plan after seeding')
  expect('nothing to do when Confluence matches', quiet?.ops ?? 'failed', [])

  const props = async id => (await call(R, 'GET', `/api/v2/pages/${id}/properties?key=docs-sync`)).results[0]
  const overview = ids.get('docs/overview.md')
  const stale = await props(overview)
  await call(W, 'PUT', `/api/v2/pages/${overview}/properties/${stale.id}`, {
    key: 'docs-sync',
    value: { ...stale.value, hash: 'old' },
    version: { number: stale.version.number + 1 },
  })
  await update(ids.get('docs/monitoring.yaml'), {})
  await update(ids.get('docs/logging.yaml'), { parentId: overview, body: adf('Payments: Logging') })
  const loggingMarker = await props(ids.get('docs/logging.yaml'))
  await call(W, 'PUT', `/api/v2/pages/${ids.get('docs/logging.yaml')}/properties/${loggingMarker.id}`, {
    key: 'docs-sync',
    value: { ...loggingMarker.value, version: (await page(ids.get('docs/logging.yaml'))).version.number },
    version: { number: loggingMarker.version.number + 1 },
  })
  const gone = await create(`Gone ${run}`, root)
  await mark(gone, { source: 'docs/gone.md', hash: 'x', version: 1 })

  const before = await call(R, 'GET', `/api/v2/pages/${root}/descendants?limit=250`)
  const versions = async () =>
    Promise.all(before.results.map(async item => `${item.id}:${(await page(item.id)).version.number}`))
  const snapshot = await versions()
  const changed = plan('Plan after changes in Confluence')
  expect('update, manual edit, move and archive', changed ? kinds(changed) : 'failed', [
    'archive risky docs/gone.md',
    'move risky docs/logging.yaml',
    'update(content) docs/overview.md',
    'update(manual-edit) risky docs/monitoring.yaml',
  ])
  expect('risk', changed?.risk, 'high')
  expect('plan made no writes', await versions(), snapshot)
} catch (cause) {
  failed = true
  say(`\nStopped: ${cause.message}`)
} finally {
  const all = await call(R, 'GET', `/api/v2/pages/${root}/descendants?limit=250`).catch(() => ({ results: [] }))
  const pages = [root, ...all.results.filter(item => item.type === 'page').map(item => item.id)]
  await call(W, 'POST', '/rest/api/content/archive', { pages: pages.map(id => ({ id: Number(id) })) }).catch(cause =>
    say(`\nCleanup failed: ${cause.message}`),
  )
  appendFileSync(process.env.GITHUB_STEP_SUMMARY ?? '/dev/null', `## Plan check\n${summary.join('\n')}\n`)
  if (failed) process.exitCode = 1
}
