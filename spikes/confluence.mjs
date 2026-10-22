import { appendFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { deflateSync } from 'node:zlib'

const required = name => {
  const value = process.env[name]
  if (!value) throw new Error(`missing ${name}`)
  return value
}

const cfg = {
  site: required('CONFLUENCE_SITE').replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
  pinnedCloudId: process.env.CONFLUENCE_CLOUD_ID ?? '',
  email: required('CONFLUENCE_SPIKE_EMAIL'),
  readToken: required('CONFLUENCE_SPIKE_READ_TOKEN'),
  writeToken: required('CONFLUENCE_SPIKE_WRITE_TOKEN'),
  testSpace: required('CONFLUENCE_TEST_SPACE'),
  eaSpace: required('CONFLUENCE_EA_SPACE'),
  eaFolder: process.env.CONFLUENCE_EA_FOLDER ?? '',
  run: process.env.GITHUB_RUN_ID ?? String(Date.now()),
}

if (!/^[a-z0-9-]+\.atlassian\.net$/.test(cfg.site)) throw new Error('CONFLUENCE_SITE must look like name.atlassian.net')
const tenant = await fetch(`https://${cfg.site}/_edge/tenant_info`, { redirect: 'error' }).then(r => r.json())
const cloudId = tenant.cloudId
if (!/^[0-9a-f-]{36}$/.test(cloudId ?? '')) throw new Error('tenant_info returned no cloud id')
const base = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki`
const R = cfg.readToken
const W = cfg.writeToken
const findings = []
let authMode = 'basic'

const note = (id, data) => {
  findings.push({ id, ...data })
  console.log(`\n### ${id}\n${JSON.stringify(data, null, 2)}`)
}

const authHeader = token =>
  authMode === 'bearer'
    ? `Bearer ${token}`
    : `Basic ${Buffer.from(`${cfg.email}:${token}`).toString('base64')}`

async function call(token, method, path, { json, form, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    redirect: 'error',
    headers: {
      Authorization: authHeader(token),
      Accept: 'application/json',
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: json ? JSON.stringify(json) : form,
  })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text.slice(0, 300)
  }
  const rate = Object.fromEntries([...res.headers].filter(([k]) => /ratelimit|retry-after/i.test(k)))
  return { status: res.status, body, rate }
}

const errorText = body =>
  typeof body === 'string'
    ? body
    : JSON.stringify(body?.errors ?? body?.message ?? body?.title ?? body).slice(0, 300)

const brief = r => (r.status < 300 ? { status: r.status } : { status: r.status, error: errorText(r.body) })

async function step(id, fn) {
  try {
    await fn()
  } catch (e) {
    note(id, { failed: String(e?.message ?? e).slice(0, 300) })
  }
}

const walk = (node, visit) => {
  if (Array.isArray(node)) return node.forEach(n => walk(n, visit))
  if (node && typeof node === 'object') {
    visit(node)
    Object.values(node).forEach(v => walk(v, visit))
  }
}

const strings = node => {
  const out = []
  walk(node, n => Object.values(n).forEach(v => typeof v === 'string' && out.push(v)))
  return out
}

const replaceStrings = (node, from, to) =>
  JSON.parse(JSON.stringify(node), (k, v) => {
    if (k === 'localId') return randomUUID()
    return typeof v === 'string' && v === from ? to : v
  })

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

const crc32 = buf => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([len, typed, crc])
}

const png = (w, h, rgb) => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.from([0, ...Array.from({ length: w }, () => rgb).flat()])
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const drawioXml = `<mxfile host="docs-sync-spike"><diagram id="d1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Repo" style="rounded=1;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell><mxCell id="3" value="Confluence" style="rounded=1;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="240" y="40" width="120" height="60" as="geometry"/></mxCell><mxCell id="4" edge="1" parent="1" source="2" target="3"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`

const doc = content => JSON.stringify({ type: 'doc', version: 1, content })
const para = text => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const adfBody = content => ({ representation: 'atlas_doc_format', value: doc(content) })

async function upload(pageId, name, data, type) {
  const form = new FormData()
  form.append('file', new Blob([data], { type }), name)
  form.append('minorEdit', 'true')
  return call(W, 'POST', `/rest/api/content/${pageId}/child/attachment`, {
    form,
    headers: { 'X-Atlassian-Token': 'no-check' },
  })
}

async function findPage(spaceId, title) {
  const r = await call(R, 'GET', `/api/v2/pages?space-id=${spaceId}&title=${encodeURIComponent(title)}&body-format=atlas_doc_format`)
  return r.body?.results?.[0]
}

async function ensurePage(token, space, parentId, title, labels = []) {
  const existing = await findPage(space.id, title)
  if (existing) return existing.id
  const r = await call(token, 'POST', '/api/v2/pages', {
    json: { spaceId: space.id, status: 'current', title, parentId, body: adfBody([para(`${title}. Fixture created by the docs-sync spike.`)]) },
  })
  if (r.status >= 300) throw new Error(`create ${title}: ${errorText(r.body)}`)
  if (labels.length)
    await call(token, 'POST', `/rest/api/content/${r.body.id}/label`, { json: labels.map(name => ({ prefix: 'global', name })) })
  return r.body.id
}

let dst
let ea
let sample
let sampleAdf
let sampleAttachments = []
let runPage
const ctx = {}

await step('auth', async () => {
  const result = {}
  for (const mode of ['basic', 'bearer']) {
    authMode = mode
    const r = await call(R, 'GET', `/api/v2/spaces?keys=${cfg.testSpace},${cfg.eaSpace}`)
    result[mode] = brief(r)
    if (r.status === 200 && !dst) {
      dst = r.body.results.find(s => s.key === cfg.testSpace)
      ea = r.body.results.find(s => s.key === cfg.eaSpace)
      result.chosen = mode
      result.rateHeaders = r.rate
    }
  }
  authMode = result.chosen ?? 'basic'
  result.cloudId = { derivedFromSite: true, matchesPinned: cfg.pinnedCloudId ? cfg.pinnedCloudId === cloudId : null }
  note('auth', result)
  if (!dst || !ea) throw new Error('spaces not found; check keys and token')
  note('spaces', { dst: { id: dst.id, homepageId: dst.homepageId }, ea: { id: ea.id, homepageId: ea.homepageId } })
})

if (!dst || !ea) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY ?? '/dev/null', 'Spike stopped: authentication or space lookup failed. See log.\n')
  process.exit(1)
}

const folderChildren = async id => {
  const r = await call(R, 'GET', `/api/v2/folders/${id}/direct-children?limit=250`)
  if (r.status >= 300) throw new Error(`folder children: ${errorText(r.body)}`)
  return r.body.results ?? []
}

const folderTree = async (id, depth = 0) => {
  const out = []
  for (const c of await folderChildren(id)) {
    const node = { type: c.type, id: c.id, title: c.title }
    if (c.type === 'folder' && depth < 4) node.children = await folderTree(c.id, depth + 1)
    out.push(node)
  }
  return out
}

await step('ea-folder', async () => {
  if (!cfg.eaFolder) return note('ea-folder', { skipped: 'no CONFLUENCE_EA_FOLDER' })
  const [first, ...rest] = cfg.eaFolder.split('/').map(s => s.trim()).filter(Boolean)
  const cql = encodeURIComponent(`space="${cfg.eaSpace}" and type=folder and title="${first}"`)
  const search = await call(R, 'GET', `/rest/api/search?cql=${cql}`)
  const candidates = search.body?.results?.map(x => x.content?.id).filter(Boolean) ?? []
  let id = candidates[0]
  let via = 'cql'
  if (!id) {
    const home = await call(R, 'GET', `/api/v2/pages/${ea.homepageId}/direct-children?limit=250`)
    id = home.body?.results?.find(c => c.type === 'folder' && c.title === first)?.id
    via = `homepage children (${home.status})`
  }
  if (!id) throw new Error(`folder "${first}" not found`)
  for (const segment of rest) {
    const next = (await folderChildren(id)).find(c => c.type === 'folder' && c.title === segment)
    if (!next) throw new Error(`folder "${segment}" not found`)
    id = next.id
  }
  ctx.folder = id
  ctx.tree = await folderTree(id)
  const folder = await call(R, 'GET', `/api/v2/folders/${id}`)
  note('ea-folder', {
    rootSearch: { ...brief(search), candidates: candidates.length, via },
    root: { id, ...brief(folder), parentId: folder.body?.parentId, parentType: folder.body?.parentType },
    tree: ctx.tree,
  })
})

await step('ea-fixtures', async () => {
  const parent = ctx.folder ?? ea.homepageId
  ctx.fixtures = [
    await ensurePage(W, ea, parent, 'ADR-901 Spike fixture'),
    await ensurePage(W, ea, parent, 'ADR-9010 Spike fixture', ['superseded']),
  ]
  const placed = await call(R, 'GET', `/api/v2/pages/${ctx.fixtures[0]}`)
  note('ea-fixtures', { ids: ctx.fixtures, parentId: placed.body?.parentId, parentType: placed.body?.parentType })
})

await step('sample-page', async () => {
  sample = await findPage(dst.id, 'Spike sample')
  if (!sample) throw new Error('page "Spike sample" not found in test space')
  sampleAdf = JSON.parse(sample.body.atlas_doc_format.value)
  const nodes = []
  walk(sampleAdf, n => {
    if (/extension|media/i.test(n.type ?? '')) nodes.push(n)
  })
  const att = await call(R, 'GET', `/api/v2/pages/${sample.id}/attachments`)
  sampleAttachments = att.body?.results ?? []
  note('sample-page', {
    nodes,
    attachments: sampleAttachments.map(a => ({ title: a.title, mediaType: a.mediaType, fileId: a.fileId, fileSize: a.fileSize, comment: a.comment })),
  })
})

await step('read-scope-matrix', async () => {
  const id = sample?.id ?? dst.homepageId
  const cql = encodeURIComponent(`space="${cfg.eaSpace}" and type=page`)
  const endpoints = {
    'v2 page': `/api/v2/pages/${id}`,
    'v2 page adf': `/api/v2/pages/${id}?body-format=atlas_doc_format`,
    'v2 attachments': `/api/v2/pages/${id}/attachments`,
    'v2 labels': `/api/v2/pages/${id}/labels`,
    'v2 properties': `/api/v2/pages/${id}/properties`,
    'v2 direct children': `/api/v2/pages/${id}/direct-children`,
    'v2 descendants': `/api/v2/pages/${id}/descendants`,
    'v2 ancestors': `/api/v2/pages/${id}/ancestors`,
    'v2 space permissions': `/api/v2/spaces/${dst.id}/permissions`,
    'v1 restrictions': `/rest/api/content/${id}/restriction`,
    'v1 search': `/rest/api/search?cql=${cql}`,
    'v1 content search': `/rest/api/content/search?cql=${cql}`,
  }
  const result = {}
  for (const [name, path] of Object.entries(endpoints)) result[name] = brief(await call(R, 'GET', path))
  note('read-scope-matrix', result)
})

await step('create-and-titles', async () => {
  const title = `Spike run ${cfg.run}`
  const r = await call(W, 'POST', '/api/v2/pages', {
    json: { spaceId: dst.id, status: 'current', title, parentId: dst.homepageId, body: adfBody([para('Created by the docs-sync spike.')]) },
  })
  if (r.status >= 300) throw new Error(`create: ${errorText(r.body)}`)
  runPage = r.body
  const sameSpace = await call(W, 'POST', '/api/v2/pages', {
    json: { spaceId: dst.id, status: 'current', title, parentId: dst.homepageId, body: adfBody([para('duplicate')]) },
  })
  const otherSpace =
    ea.id === dst.id
      ? { status: 0, body: 'skipped: external decisions share the test space' }
      : await call(W, 'POST', '/api/v2/pages', {
          json: { spaceId: ea.id, status: 'current', title, parentId: ea.homepageId, body: adfBody([para('duplicate in other space')]) },
        })
  note('create-and-titles', {
    created: { id: runPage.id, version: runPage.version?.number, webui: runPage._links?.webui },
    duplicateSameSpace: brief(sameSpace),
    duplicateOtherSpace: brief(otherSpace),
  })
})

if (!runPage) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY ?? '/dev/null', 'Spike stopped: page creation failed. See log.\n')
  process.exit(1)
}

await step('property-version', async () => {
  const version = async () => (await call(R, 'GET', `/api/v2/pages/${runPage.id}`)).body?.version?.number
  const before = await version()
  const created = await call(W, 'POST', `/api/v2/pages/${runPage.id}/properties`, {
    json: { key: 'docs-sync', value: { source: 'docs/spike.md', hash: 'sha256:test' } },
  })
  const afterCreate = await version()
  const updated = created.body?.id
    ? await call(W, 'PUT', `/api/v2/pages/${runPage.id}/properties/${created.body.id}`, {
        json: { key: 'docs-sync', value: { source: 'docs/spike.md', hash: 'sha256:test2' }, version: { number: created.body.version.number + 1 } },
      })
    : null
  const afterUpdate = await version()
  const read = await call(R, 'GET', `/api/v2/pages/${runPage.id}/properties`)
  note('property-version', {
    create: brief(created),
    update: updated && brief(updated),
    readBack: brief(read),
    pageVersion: { before, afterCreate, afterUpdate },
  })
})

await step('attachments', async () => {
  const image = await upload(runPage.id, 'spike.png', png(64, 32, [37, 99, 235]), 'image/png')
  const diagramSample = sampleAttachments.find(a => /drawio|mxfile|xml/i.test(`${a.mediaType} ${a.title}`))
  ctx.diagramName = diagramSample?.title?.includes('.') ? 'spike-diagram.drawio' : 'spike-diagram'
  const diagram = await upload(runPage.id, ctx.diagramName, drawioXml, diagramSample?.mediaType ?? 'application/vnd.jgraph.mxfile')
  const listed = await call(R, 'GET', `/api/v2/pages/${runPage.id}/attachments`)
  ctx.image = listed.body?.results?.find(a => a.title === 'spike.png')
  note('attachments', {
    v1Image: { ...brief(image), result: image.body?.results?.[0] && { id: image.body.results[0].id, extensions: image.body.results[0].extensions } },
    v1Diagram: { ...brief(diagram), mediaTypeUsed: diagramSample?.mediaType ?? 'application/vnd.jgraph.mxfile' },
    v2Listing: (listed.body?.results ?? []).map(a => ({ title: a.title, mediaType: a.mediaType, fileId: a.fileId })),
  })
})

await step('labels', async () => {
  const add = await call(W, 'POST', `/rest/api/content/${runPage.id}/label`, {
    json: [{ prefix: 'global', name: 'ea-adr-001' }, { prefix: 'global', name: 'docs-sync' }],
  })
  const read = await call(R, 'GET', `/api/v2/pages/${runPage.id}/labels`)
  const remove = await call(W, 'DELETE', `/rest/api/content/${runPage.id}/label/docs-sync`)
  note('labels', { addV1: brief(add), readV2: { ...brief(read), names: read.body?.results?.map(l => l.name) }, removeV1: brief(remove) })
})

await step('body-update', async () => {
  const content = [para('Image from attachment:')]
  if (ctx.image?.fileId)
    content.push({
      type: 'mediaSingle',
      attrs: { layout: 'center' },
      content: [{ type: 'media', attrs: { type: 'file', id: ctx.image.fileId, collection: `contentId-${runPage.id}`, width: 64, height: 32 } }],
    })
  const sampleNodes = []
  walk(sampleAdf ?? {}, n => /extension/i.test(n.type ?? '') && sampleNodes.push(n))
  const anchor = sampleNodes.find(n => strings(n).includes('test-anchor'))
  if (anchor) content.push(para('Anchor copied from sample:'), replaceStrings(anchor, 'test-anchor', 'spike-anchor'))
  const diagramTitle = sampleAttachments.map(a => a.title).find(t => sampleNodes.some(n => strings(n).includes(t)))
  const drawio = sampleNodes.find(n => diagramTitle && strings(n).includes(diagramTitle))
  if (drawio) content.push(para('draw.io macro copied from sample:'), replaceStrings(drawio, diagramTitle, ctx.diagramName))
  const current = await call(R, 'GET', `/api/v2/pages/${runPage.id}`)
  const put = await call(W, 'PUT', `/api/v2/pages/${runPage.id}`, {
    json: {
      id: runPage.id,
      status: 'current',
      title: runPage.title,
      body: adfBody(content),
      version: { number: current.body.version.number + 1, message: 'docs-sync spike' },
    },
  })
  const back = await call(R, 'GET', `/api/v2/pages/${runPage.id}?body-format=atlas_doc_format`)
  const stored = []
  walk(back.body?.body?.atlas_doc_format?.value ? JSON.parse(back.body.body.atlas_doc_format.value) : {}, n => {
    if (/extension|media/i.test(n.type ?? '')) stored.push(n)
  })
  note('body-update', {
    put: brief(put),
    sent: { image: Boolean(ctx.image?.fileId), anchor: Boolean(anchor), drawio: Boolean(drawio), diagramTitle },
    stored,
    webui: runPage._links?.webui,
  })
})

await step('move', async () => {
  const child = await call(W, 'POST', '/api/v2/pages', {
    json: { spaceId: dst.id, status: 'current', title: `Spike child ${cfg.run}`, parentId: runPage.id, body: adfBody([para('child')]) },
  })
  if (child.status >= 300) throw new Error(`create child: ${errorText(child.body)}`)
  ctx.child = child.body.id
  const v1 = await call(W, 'PUT', `/rest/api/content/${ctx.child}/move/append/${dst.homepageId}`)
  const current = await call(R, 'GET', `/api/v2/pages/${ctx.child}`)
  const v2 = await call(W, 'PUT', `/api/v2/pages/${ctx.child}`, {
    json: {
      id: ctx.child,
      status: 'current',
      title: current.body.title,
      parentId: runPage.id,
      body: adfBody([para('child')]),
      version: { number: current.body.version.number + 1 },
    },
  })
  const after = await call(R, 'GET', `/api/v2/pages/${ctx.child}`)
  note('move', { v1Move: brief(v1), v2ParentChange: brief(v2), parentAfter: after.body?.parentId, expectedV2Parent: runPage.id })
})

await step('archive', async () => {
  const r = await call(W, 'POST', '/rest/api/content/archive', { json: { pages: [{ id: Number(ctx.child) }] } })
  note('archive', { ...brief(r), body: r.status < 300 ? r.body : undefined })
})

await step('restrictions', async () => {
  const r = await call(R, 'GET', `/rest/api/content/${runPage.id}/restriction`)
  const perms = await call(R, 'GET', `/api/v2/spaces/${dst.id}/permissions`)
  note('restrictions', {
    pageRestrictions: { ...brief(r), sample: r.status < 300 ? JSON.stringify(r.body).slice(0, 600) : undefined },
    spacePermissions: { ...brief(perms), count: perms.body?.results?.length, sample: perms.body?.results?.slice(0, 3) },
  })
})

await step('ea-resolution', async () => {
  const decisions = []
  const collect = (nodes, path) => {
    for (const n of nodes) {
      if (n.type === 'folder') collect(n.children ?? [], [...path, n.title])
      else if (/^ADR-\d+/.test(n.title)) decisions.push({ id: n.id, title: n.title, folderPath: path.join('/') })
    }
  }
  collect(ctx.tree ?? [], [])
  for (const d of decisions.slice(0, 5)) {
    const anc = await call(R, 'GET', `/api/v2/pages/${d.id}/ancestors`)
    d.ancestors = anc.status < 300 ? anc.body.results.map(a => ({ id: a.id, type: a.type })) : brief(anc)
  }
  const realId = decisions.map(d => d.title.match(/^ADR-\d+/)[0]).find(id => !id.startsWith('ADR-9')) ?? 'ADR-901'
  const queries = {
    titleContains: `space="${cfg.eaSpace}" and type=page and title ~ "${realId}"`,
    prefixAmbiguity: `space="${cfg.eaSpace}" and type=page and title ~ "ADR-901"`,
    byLabel: `space="${cfg.eaSpace}" and type=page and label = "superseded"`,
    ...(ctx.folder ? { inFolderNested: `space="${cfg.eaSpace}" and type=page and ancestor = ${ctx.folder} and title ~ "${realId}"` } : {}),
  }
  const result = { decisionsInTree: decisions }
  for (const [name, q] of Object.entries(queries)) {
    const r = await call(R, 'GET', `/rest/api/search?cql=${encodeURIComponent(q)}`)
    result[name] = { ...brief(r), titles: r.body?.results?.map(x => x.content?.title ?? x.title) }
  }
  note('ea-resolution', result)
})

const summary = [
  '## Confluence spike findings',
  '',
  '| Step | Result |',
  '| --- | --- |',
  ...findings.map(f => `| ${f.id} | ${f.failed ? `failed: ${f.failed}` : 'see log'} |`),
  '',
  runPage?._links?.webui ? `Run page: https://${cfg.site}/wiki${runPage._links.webui}` : '',
].join('\n')
appendFileSync(process.env.GITHUB_STEP_SUMMARY ?? '/dev/null', `${summary}\n`)
