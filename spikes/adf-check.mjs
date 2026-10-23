import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const required = name => {
  const value = process.env[name]
  if (!value) throw new Error(`missing ${name}`)
  return value
}

const site = required('CONFLUENCE_SITE')
  .replace(/^https?:\/\//, '')
  .replace(/\/.*$/, '')
if (!/^[a-z0-9-]+\.atlassian\.net$/.test(site)) throw new Error('CONFLUENCE_SITE must look like name.atlassian.net')
const email = process.env.CONFLUENCE_SPIKE_EMAIL ?? ''
const read = required('CONFLUENCE_SPIKE_READ_TOKEN')
const write = required('CONFLUENCE_SPIKE_WRITE_TOKEN')
const spaceKey = required('CONFLUENCE_TEST_SPACE')
const goldenDir = 'test/golden'

const tenant = await fetch(`https://${site}/_edge/tenant_info`, { redirect: 'error' }).then(r => r.json())
if (!/^[0-9a-f-]{36}$/.test(tenant.cloudId ?? '')) throw new Error('tenant_info returned no cloud id')
const base = `https://api.atlassian.com/ex/confluence/${tenant.cloudId}/wiki`
const auth = token => (email ? `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` : `Bearer ${token}`)

async function call(token, method, path, { json, form, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    redirect: 'error',
    headers: {
      Authorization: auth(token),
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
  if (res.status >= 300)
    throw new Error(`${method} ${path.split('?')[0]}: ${res.status} ${JSON.stringify(body).slice(0, 400)}`)
  return body
}

const types = (node, counts = {}) => {
  counts[node.type] = (counts[node.type] ?? 0) + 1
  for (const child of node.content ?? []) types(child, counts)
  return counts
}

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
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const body = adf => ({ representation: 'atlas_doc_format', value: JSON.stringify(adf) })
const placeholder = text => ({
  type: 'doc',
  version: 1,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

async function page(spaceId, parentId, title) {
  const found = await call(read, 'GET', `/api/v2/pages?space-id=${spaceId}&title=${encodeURIComponent(title)}`)
  if (found.results?.[0]) return found.results[0].id
  const created = await call(write, 'POST', '/api/v2/pages', {
    json: { spaceId, status: 'current', title, parentId, body: body(placeholder('ADF check page')) },
  })
  return created.id
}

async function attachment(pageId) {
  const existing = await call(read, 'GET', `/api/v2/pages/${pageId}/attachments?filename=diagram.png`)
  if (existing.results?.[0]?.fileId) return existing.results[0].fileId
  const form = new FormData()
  form.append('file', new Blob([png(240, 120, [94, 129, 172])], { type: 'image/png' }), 'diagram.png')
  form.append('minorEdit', 'true')
  await call(write, 'POST', `/rest/api/content/${pageId}/child/attachment`, {
    form,
    headers: { 'X-Atlassian-Token': 'no-check' },
  })
  const after = await call(read, 'GET', `/api/v2/pages/${pageId}/attachments?filename=diagram.png`)
  return after.results?.[0]?.fileId
}

const space = (await call(read, 'GET', `/api/v2/spaces?keys=${spaceKey}`)).results?.[0]
if (!space) throw new Error(`space ${spaceKey} not found`)
const root = await page(space.id, space.homepageId, 'docs-sync ADF check')
const rows = []
let failed = false

for (const file of readdirSync(goldenDir)
  .filter(name => name.endsWith('.json'))
  .sort()) {
  const name = file.replace(/\.json$/, '')
  try {
    const id = await page(space.id, root, `ADF check: ${name}`)
    let text = readFileSync(`${goldenDir}/${file}`, 'utf8')
    if (text.includes('"type": "media"')) {
      const fileId = await attachment(id)
      text = text.replace(/"id": "file-[^"]*"/g, `"id": "${fileId}"`).replace(/contentId-1/g, `contentId-${id}`)
    }
    const adf = JSON.parse(text)
    const current = await call(read, 'GET', `/api/v2/pages/${id}`)
    await call(write, 'PUT', `/api/v2/pages/${id}`, {
      json: {
        id,
        status: 'current',
        title: current.title,
        body: body(adf),
        version: { number: current.version.number + 1, message: 'docs-sync ADF check' },
      },
    })
    const back = await call(read, 'GET', `/api/v2/pages/${id}?body-format=atlas_doc_format`)
    const stored = types(JSON.parse(back.body.atlas_doc_format.value))
    const missing = Object.entries(types(adf))
      .filter(([type, count]) => (stored[type] ?? 0) < count)
      .map(([type]) => type)
    if (missing.length) failed = true
    rows.push(`| ${name} | accepted | ${missing.join(', ') || 'none'} | https://${site}/wiki${back._links.webui} |`)
  } catch (cause) {
    failed = true
    rows.push(
      `| ${name} | refused | ${String(cause.message ?? cause)
        .replace(/\|/g, '/')
        .slice(0, 300)} | |`,
    )
  }
}

const summary = ['| Page | Result | Lost nodes | Link |', '| --- | --- | --- | --- |', ...rows].join('\n')
console.log(summary)
appendFileSync(process.env.GITHUB_STEP_SUMMARY ?? '/dev/null', `${summary}\n`)
if (failed) process.exit(1)
