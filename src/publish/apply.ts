import type { Reader } from '../confluence/reader.ts'
import type { Writer } from '../confluence/writer.ts'
import type { Classified, Op } from '../plan/diff.ts'
import { markerKey, type Owned } from '../plan/state.ts'
import type { Node } from '../render/adf.ts'
import type { Bundle } from './bundle.ts'
import { signedMarker } from './marker.ts'

type Parent = Extract<Op, { kind: 'create' }>['parent']

export interface ApplyInput {
  readonly reader: Reader
  readonly writer: Writer
  readonly bundle: Bundle
  readonly ops: readonly Classified[]
  readonly owned: readonly Owned[]
  readonly key: string
  readonly site: string
  readonly space: { readonly key: string; readonly id: string }
}

const pagePrefix = 'docs-sync:page/'

function macroAttrs(attrs: Readonly<Record<string, unknown>>, pageId: string) {
  const parameters = attrs['parameters'] as { guestParams: Record<string, unknown> }
  return { ...attrs, parameters: { ...parameters, guestParams: { ...parameters.guestParams, pageId } } }
}

function resolveBody(
  node: Node,
  pageId: string,
  link: (href: string) => string,
  file: (id: string) => Readonly<Record<string, string>>,
): Node {
  return {
    ...node,
    ...(node.type === 'media' && node.attrs ? { attrs: { ...node.attrs, ...file(String(node.attrs['id'])) } } : {}),
    ...(node.type === 'extension' && node.attrs ? { attrs: macroAttrs(node.attrs, pageId) } : {}),
    ...(node.marks
      ? {
          marks: node.marks.map(mark =>
            mark.type === 'link' && mark.attrs.href.startsWith(pagePrefix)
              ? { ...mark, attrs: { href: link(mark.attrs.href) } }
              : mark,
          ),
        }
      : {}),
    ...(node.content ? { content: node.content.map(child => resolveBody(child, pageId, link, file)) } : {}),
  }
}

export async function apply(input: ApplyInput): Promise<void> {
  const { reader, writer, bundle, ops, owned, key, site, space } = input
  const ids = new Map(owned.map(page => [page.key, page.id]))
  const parentId = (parent: Parent) => ('page' in parent ? parent.page : ids.get(parent.key))
  const sign = (page: string, source: string, hash: string, version: number) =>
    writer.setProperty(page, markerKey, signedMarker(key, { page, source, hash, version }))
  const version = async (page: string) => (await reader.item('page', page))?.version ?? 0

  let pending = ops.flatMap(({ op }) => (op.kind === 'create' ? [op] : []))
  while (pending.length) {
    const waiting: typeof pending = []
    for (const op of pending) {
      const parent = parentId(op.parent)
      if (parent === undefined) {
        waiting.push(op)
        continue
      }
      const created = await writer.createPage(space.id, parent, op.title)
      ids.set(op.key, created.id)
      await sign(created.id, op.key, '', created.version)
    }
    if (waiting.length === pending.length) throw new Error('New pages wait on parents that are never created')
    pending = waiting
  }

  for (const { op } of ops) {
    if (op.kind !== 'move') continue
    await writer.move(op.page, parentId(op.to) ?? '')
    await sign(op.page, op.key, owned.find(page => page.key === op.key)?.hash ?? '', await version(op.page))
  }

  const link = (href: string) => {
    const [path = '', anchor] = href.slice(pagePrefix.length).split('#')
    const target = ids.get(decodeURIComponent(path))
    if (!target) throw new Error(`A link points at ${decodeURIComponent(path)}, which has no page`)
    return `https://${site}/wiki/spaces/${space.key}/pages/${target}${anchor ? `#${anchor}` : ''}`
  }
  for (const page of bundle.plan.pages) {
    const id = ids.get(page.key) ?? ''
    const existing = await reader.attachments(id)
    let uploaded = false
    for (const name of page.attachments) {
      const image = bundle.images.get(name)
      if (!image || existing.some(file => file.title === name && file.comment === image.sha256)) continue
      await writer.upload(id, name, image.data, image.sha256)
      uploaded = true
    }
    const files = new Map((uploaded ? await reader.attachments(id) : existing).map(file => [file.title, file.fileId]))
    const body = resolveBody(page.body, id, link, (media: string) => {
      const name = media.replace(/^docs-sync:attachment\//, '')
      const fileId = files.get(name)
      if (!fileId) throw new Error(`Image ${name} did not upload to page ${id}`)
      return { id: fileId, collection: `contentId-${id}` }
    })
    const labels = await reader.labels(id)
    const add = page.labels.filter(label => !labels.includes(label))
    if (add.length) await writer.addLabels(id, add)
    for (const label of labels.filter(label => !page.labels.includes(label))) await writer.removeLabel(id, label)
    const next = await writer.updatePage(id, page.title, body, (await version(id)) + 1)
    await sign(id, page.key, page.hash, next)
  }

  const archived = ops.flatMap(({ op }) => (op.kind === 'archive' ? [op.page] : []))
  if (archived.length) await writer.archive(archived)
}
