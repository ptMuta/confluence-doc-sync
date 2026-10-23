import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { z } from 'zod'
import { hashFiles } from '../plan/bundle.ts'
import { sha256 } from '../plan/hash.ts'
import type { Node } from '../render/adf.ts'

const maxBytes = 200_000_000
const maxDepth = 64

const id = z.string().regex(/^\d+$/)
const parent = z.union([z.strictObject({ page: id }), z.strictObject({ key: z.string().min(1) })])
const op = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('create'), key: z.string().min(1), title: z.string().min(1), parent }),
  z.strictObject({
    kind: z.literal('update'),
    key: z.string().min(1),
    page: id,
    title: z.string().min(1),
    changes: z.array(z.enum(['content', 'title', 'manual-edit'])).min(1),
  }),
  z.strictObject({ kind: z.literal('move'), key: z.string().min(1), page: id, from: z.string(), to: parent }),
  z.strictObject({ kind: z.literal('archive'), key: z.string().min(1), page: id, title: z.string() }),
])

const planSchema = z.strictObject({
  version: z.literal(1),
  commit: z.string().optional(),
  run: z.string().optional(),
  site: z.string(),
  cloudId: z.string(),
  space: z.strictObject({ key: z.string(), id: z.string() }),
  root: id,
  approval: z.enum(['none', 'always', 'on-risk']),
  risk: z.enum(['low', 'high']),
  visibility: z.strictObject({
    mode: z.enum(['space', 'restricted', 'public']),
    openTo: z.array(z.string()),
    chain: z.array(z.strictObject({ type: z.enum(['page', 'folder']), id: z.string(), readers: z.array(z.string()) })),
  }),
  ops: z.array(z.strictObject({ op, risky: z.string().optional() })),
  pageIds: z.record(z.string(), id),
  pages: z.array(
    z.strictObject({
      key: z.string().min(1),
      title: z.string().min(1),
      parent: z.string().optional(),
      labels: z.array(z.string().regex(/^[a-z0-9_-]+$/)),
      body: z.unknown(),
      attachments: z.array(z.string().regex(/^(?!\.)[^/\\]+\.png$/)),
      hash: z.string(),
    }),
  ),
})

type BundlePlan = Omit<z.output<typeof planSchema>, 'pages'> & {
  readonly pages: readonly (Omit<z.output<typeof planSchema>['pages'][number], 'body'> & { readonly body: Node })[]
}

export interface Bundle {
  readonly plan: BundlePlan
  readonly images: ReadonlyMap<string, { readonly sha256: string; readonly data: Buffer }>
}

const blocks = new Set([
  'doc',
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
  'codeBlock',
  'panel',
  'mediaSingle',
  'media',
  'caption',
  'text',
  'hardBreak',
  'inlineExtension',
])
const marks = new Set(['strong', 'em', 'strike', 'code', 'link'])
const nodeKeys = new Set(['type', 'attrs', 'content', 'marks', 'text'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function checkNode(value: unknown, attachments: ReadonlySet<string>, depth = 0): string | undefined {
  if (depth > maxDepth) return 'the page body is nested too deeply'
  if (!isRecord(value) || typeof value['type'] !== 'string') return 'a page body node is malformed'
  const { type, attrs, content, text } = value
  if (!blocks.has(type)) return `node type ${type} is not allowed`
  if (Object.keys(value).some(key => !nodeKeys.has(key))) return `node ${type} has unknown fields`
  if (attrs !== undefined && !isRecord(attrs)) return `node ${type} has malformed attrs`
  if (text !== undefined && (type !== 'text' || typeof text !== 'string')) return `node ${type} has malformed text`
  if (
    type === 'inlineExtension' &&
    (attrs?.['extensionKey'] !== 'anchor' || attrs['extensionType'] !== 'com.atlassian.confluence.macro.core')
  )
    return 'only anchor macros are allowed'
  if (type === 'media') {
    const file = typeof attrs?.['id'] === 'string' ? attrs['id'].replace(/^docs-sync:attachment\//, '') : ''
    if (attrs?.['type'] !== 'file' || attrs['collection'] !== 'docs-sync:collection' || !attachments.has(file))
      return 'a media node does not point at a bundled image'
  }
  const markList = value['marks'] ?? []
  if (!Array.isArray(markList)) return `node ${type} has malformed marks`
  for (const mark of markList) {
    if (!isRecord(mark) || typeof mark['type'] !== 'string' || !marks.has(mark['type'])) return 'a mark is not allowed'
    const href = isRecord(mark['attrs']) ? mark['attrs']['href'] : undefined
    if (mark['type'] === 'link' && (typeof href !== 'string' || !/^(?:https:\/\/|docs-sync:page\/)/.test(href)))
      return 'a link is not https or a page link'
  }
  if (content === undefined) return undefined
  if (!Array.isArray(content)) return `node ${type} has malformed content`
  for (const child of content) {
    const problem = checkNode(child, attachments, depth + 1)
    if (problem) return problem
  }
  return undefined
}

export async function readBundle(dir: string, expected: string): Promise<Bundle> {
  if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error('expected-bundle-sha256 must be 64 lowercase hex characters')
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  const paths: string[] = []
  for (const entry of entries) {
    const path = relative(dir, join(entry.parentPath, entry.name)).split('\\').join('/')
    if (entry.isDirectory() && path === 'images') continue
    if (!entry.isFile()) throw new Error(`The bundle holds an unexpected entry: ${path}`)
    if ((await stat(join(dir, path))).size > maxBytes) throw new Error(`${path} is too large`)
    paths.push(path)
  }
  const data = new Map(await Promise.all(paths.map(async path => [path, await readFile(join(dir, path))] as const)))
  if (hashFiles([...data]) !== expected) throw new Error('The bundle does not match expected-bundle-sha256')

  const json = data.get('plan.json')
  if (!json || !data.has('docs-sync.lock')) throw new Error('The bundle has no plan.json or docs-sync.lock')
  const parsed = planSchema.safeParse(JSON.parse(json.toString('utf8')))
  if (!parsed.success) throw new Error(`plan.json is malformed: ${parsed.error.issues[0]?.message ?? ''}`)
  const plan = parsed.data

  const used = new Set(plan.pages.flatMap(page => page.attachments))
  const images = [...data.keys()].filter(path => path.startsWith('images/')).map(path => path.slice('images/'.length))
  const extra = paths.filter(path => !['plan.json', 'docs-sync.lock'].includes(path) && !path.startsWith('images/'))
  if (extra.length || images.length !== used.size || images.some(name => !used.has(name)))
    throw new Error('The bundle files do not match the images the plan uses')
  for (const page of plan.pages) {
    const problem = checkNode(page.body, new Set(page.attachments))
    if (problem) throw new Error(`Page ${page.key}: ${problem}`)
    if (!isRecord(page.body) || page.body['type'] !== 'doc')
      throw new Error(`Page ${page.key}: the body is not a document`)
  }
  return {
    plan: plan as BundlePlan,
    images: new Map(
      images.map(name => {
        const image = data.get(`images/${name}`) ?? Buffer.alloc(0)
        return [name, { sha256: sha256(image), data: image }]
      }),
    ),
  }
}
