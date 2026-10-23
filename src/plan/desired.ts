import { basename } from 'node:path'
import type { Config } from '../config/schema.ts'
import { parseDrawio } from '../diagrams/parse.ts'
import { prepare } from '../diagrams/prepare.ts'
import type { Renderer } from '../diagrams/render/drawio.ts'
import type { Theme } from '../diagrams/theme.ts'
import { error, type Finding } from '../findings.ts'
import type { Node, Resolver } from '../render/adf.ts'
import { renderPages } from '../render/pages.ts'
import type { Resolved } from '../refs/resolve.ts'
import type { Sources } from '../source/load.ts'
import { canonical, sha256 } from './hash.ts'

const pageHref = (key: string, anchor?: string): string =>
  `docs-sync:page/${encodeURIComponent(key)}${anchor ? `#${anchor}` : ''}`

const attachmentPrefix = 'docs-sync:attachment/'
export const pageIdPlaceholder = 'docs-sync:page-id'
const attachmentId = (name: string): string => `${attachmentPrefix}${name}`

export interface Image {
  readonly name: string
  readonly sha256: string
  readonly data: Buffer
}

export interface DesiredPage {
  readonly key: string
  readonly title: string
  readonly parent?: string
  readonly labels: readonly string[]
  readonly body: Node
  readonly attachments: readonly string[]
  readonly hash: string
}

export interface Desired {
  readonly pages: readonly DesiredPage[]
  readonly images: ReadonlyMap<string, Image>
  readonly findings: Finding[]
}

export interface DesiredInput {
  readonly config: Config
  readonly sources: Sources
  readonly theme: Theme
  readonly render: Renderer
  readonly read: (file: string, maxBytes: number) => Promise<string | undefined>
  readonly resolved: ReadonlyMap<string, Resolved>
  readonly blobUrl?: string
}

const pngSize = (data: Buffer) => ({ width: data.readUInt32BE(16), height: data.readUInt32BE(20) })

function baseNames(files: readonly string[]): Map<string, string> {
  const counts = new Map<string, number>()
  for (const file of files) counts.set(basename(file), (counts.get(basename(file)) ?? 0) + 1)
  return new Map(
    files.map(file => [
      file,
      (counts.get(basename(file)) === 1 ? basename(file) : file.replace(/\//g, '-')).replace(/\.drawio$/, ''),
    ]),
  )
}

const mediaIds = (node: Node): string[] => [
  ...(node.type === 'media' && typeof node.attrs?.['id'] === 'string' ? [node.attrs['id']] : []),
  ...(node.content ?? []).flatMap(mediaIds),
]

const macroNames = (node: Node): string[] => {
  const params = node.attrs?.['parameters'] as { guestParams?: { diagramName?: unknown } } | undefined
  const name = node.type === 'extension' ? params?.guestParams?.diagramName : undefined
  return [...(typeof name === 'string' ? [name, `${name}.png`] : []), ...(node.content ?? []).flatMap(macroNames)]
}

const attachmentNames = (body: Node): string[] => [
  ...new Set([
    ...mediaIds(body)
      .filter(id => id.startsWith(attachmentPrefix))
      .map(id => id.slice(attachmentPrefix.length)),
    ...macroNames(body),
  ]),
]

export function contentHash(
  page: {
    readonly title: string
    readonly parent?: string | undefined
    readonly labels: readonly string[]
    readonly body: Node
  },
  images: ReadonlyMap<string, { readonly sha256: string }>,
): string {
  const attachments = attachmentNames(page.body).flatMap(name => {
    const image = images.get(name)
    return image ? [{ name, sha256: image.sha256 }] : []
  })
  return sha256(
    canonical({ title: page.title, parent: page.parent, labels: page.labels, body: page.body, attachments }),
  )
}

export async function desiredState(input: DesiredInput): Promise<Desired> {
  const { config, sources, theme, render, read, resolved, blobUrl } = input
  const findings: Finding[] = []
  const maxBytes = config['diagram-max-mb'] * 1_000_000
  const macro = config['diagram-output'] === 'macro'
  const bases = baseNames(sources.diagrams)
  const images = new Map<string, Image & { width: number; height: number; source: Image }>()
  for (const file of sources.diagrams) {
    const [page] = parseDrawio((await read(file, maxBytes)) ?? '', maxBytes)
    if (!page) continue
    const xml = Buffer.from(prepare(page, theme).xml)
    const data = await render(xml.toString(), maxBytes)
    const base = bases.get(file) ?? basename(file)
    const source = { name: `${base}.drawio`, sha256: sha256(xml), data: xml }
    const name = macro ? `${source.name}.png` : `${base}.png`
    images.set(file, { name, sha256: sha256(data), data, ...pngSize(data), source })
  }

  const owners = new Map<string, string>([
    ...sources.decisions.map(d => [d.meta.id, pageHref(d.file)] as const),
    ...sources.entries.map(e => [e.value.id, pageHref(config.catalogs[e.catalog], e.value.id)] as const),
  ])
  const keys = new Set<string>([
    ...sources.pages.map(p => p.file),
    ...sources.decisions.map(d => d.file),
    ...sources.entries.map(e => config.catalogs[e.catalog]),
  ])
  const resolver: Resolver = {
    ref: id => {
      const external = resolved.get(id)
      if (external) return { href: external.href, title: external.title }
      const href = owners.get(id)
      return href ? { href } : undefined
    },
    path: path => (keys.has(path) ? pageHref(path) : blobUrl ? `${blobUrl}/${path}` : undefined),
    diagram: path => {
      const image = images.get(path)
      if (image && macro)
        return {
          kind: 'macro',
          extensionKey: config['drawio-macro-key'],
          name: image.source.name,
          pageId: pageIdPlaceholder,
        }
      return image
        ? {
            kind: 'image',
            id: attachmentId(image.name),
            collection: 'docs-sync:collection',
            width: Math.round(image.width / 2),
            height: Math.round(image.height / 2),
          }
        : undefined
    },
  }

  const files = [...images.values()].flatMap(({ name, sha256: hash, data, source }) => [
    { name, sha256: hash, data },
    ...(macro ? [source] : []),
  ])
  const byName = new Map(files.map(image => [image.name, image]))
  const pages = renderPages(config, sources, resolver).map(page => ({
    key: page.key,
    title: page.title,
    ...(page.parent ? { parent: page.parent } : {}),
    labels: page.labels,
    body: page.body,
    attachments: attachmentNames(page.body)
      .filter(name => byName.has(name))
      .sort(),
    hash: contentHash(page, byName),
  }))

  const titles = new Map<string, string>()
  for (const page of pages) {
    const other = titles.get(page.title)
    if (other) findings.push(error('plan/title', page.key, 1, `Title "${page.title}" is also used by ${other}`))
    else titles.set(page.title, page.key)
  }
  return {
    pages,
    images: byName,
    findings,
  }
}
