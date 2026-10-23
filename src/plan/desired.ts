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

const attachmentId = (name: string): string => `docs-sync:attachment/${name}`

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

function imageNames(files: readonly string[]): Map<string, string> {
  const counts = new Map<string, number>()
  for (const file of files) counts.set(basename(file), (counts.get(basename(file)) ?? 0) + 1)
  return new Map(
    files.map(file => [
      file,
      `${(counts.get(basename(file)) === 1 ? basename(file) : file.replace(/\//g, '-')).replace(/\.drawio$/, '')}.png`,
    ]),
  )
}

const mediaIds = (node: Node): string[] => [
  ...(node.type === 'media' && typeof node.attrs?.['id'] === 'string' ? [node.attrs['id']] : []),
  ...(node.content ?? []).flatMap(mediaIds),
]

export async function desiredState(input: DesiredInput): Promise<Desired> {
  const { config, sources, theme, render, read, resolved, blobUrl } = input
  const findings: Finding[] = []
  const maxBytes = config['diagram-max-mb'] * 1_000_000
  const names = imageNames(sources.diagrams)
  const images = new Map<string, Image & { width: number; height: number }>()
  for (const file of sources.diagrams) {
    const [page] = parseDrawio((await read(file, maxBytes)) ?? '', maxBytes)
    if (!page) continue
    const data = await render(prepare(page, theme).xml, maxBytes)
    const name = names.get(file) ?? basename(file)
    images.set(file, { name, sha256: sha256(data), data, ...pngSize(data) })
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

  const byName = new Map([...images.values()].map(image => [attachmentId(image.name), image]))
  const pages = renderPages(config, sources, resolver).map(page => {
    const attachments = [...new Set(mediaIds(page.body))].map(id => byName.get(id)).filter(image => image !== undefined)
    const content = {
      title: page.title,
      parent: page.parent,
      labels: page.labels,
      body: page.body,
      attachments: attachments.map(image => ({ name: image.name, sha256: image.sha256 })),
    }
    return {
      key: page.key,
      title: page.title,
      ...(page.parent ? { parent: page.parent } : {}),
      labels: page.labels,
      body: page.body,
      attachments: attachments.map(image => image.name).sort(),
      hash: sha256(canonical(content)),
    }
  })

  const titles = new Map<string, string>()
  for (const page of pages) {
    const other = titles.get(page.title)
    if (other) findings.push(error('plan/title', page.key, 1, `Title "${page.title}" is also used by ${other}`))
    else titles.set(page.title, page.key)
  }
  return {
    pages,
    images: new Map([...images.values()].map(({ name, sha256: hash, data }) => [name, { name, sha256: hash, data }])),
    findings,
  }
}
