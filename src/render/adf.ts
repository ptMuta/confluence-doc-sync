import { posix } from 'node:path'
import type { Block, Inline } from '../model/types.ts'

type Mark =
  | { readonly type: 'strong' | 'em' | 'strike' | 'code' }
  | { readonly type: 'link'; readonly attrs: { readonly href: string } }

export interface Node {
  readonly type: string
  readonly attrs?: Readonly<Record<string, unknown>>
  readonly content?: readonly Node[]
  readonly marks?: readonly Mark[]
  readonly text?: string
}

type Diagram =
  | {
      readonly kind: 'image'
      readonly id: string
      readonly collection: string
      readonly width: number
      readonly height: number
    }
  | { readonly kind: 'macro'; readonly extensionKey: string; readonly name: string; readonly pageId: string }

export interface Resolver {
  readonly ref: (id: string) => { readonly href: string; readonly title?: string } | undefined
  readonly path: (path: string) => string | undefined
  readonly diagram: (path: string) => Diagram | undefined
}

export const doc = (content: readonly Node[]): Node => ({ type: 'doc', attrs: { version: 1 }, content })

export const text = (value: string, marks: readonly Mark[] = []): Node[] =>
  value ? [{ type: 'text', text: value, ...(marks.length ? { marks } : {}) }] : []

const sameMarks = (a: Node, b: Node): boolean => JSON.stringify(a.marks) === JSON.stringify(b.marks)

export const paragraph = (content: readonly Node[]): Node => ({
  type: 'paragraph',
  content: content.reduce<Node[]>((merged, node) => {
    const last = merged.at(-1)
    if (last?.type === 'text' && node.type === 'text' && sameMarks(last, node))
      merged[merged.length - 1] = { ...last, text: `${last.text ?? ''}${node.text ?? ''}` }
    else merged.push(node)
    return merged
  }, []),
})

export const heading = (level: number, content: readonly Node[]): Node => ({
  type: 'heading',
  attrs: { level },
  content,
})

export const bulletList = (items: readonly (readonly Node[])[]): Node => ({
  type: 'bulletList',
  content: items.map(content => ({ type: 'listItem', content })),
})

export const panel = (panelType: 'info' | 'note' | 'warning' | 'error', content: readonly Node[]): Node => ({
  type: 'panel',
  attrs: { panelType },
  content,
})

export const table = (header: readonly (readonly Node[])[], rows: readonly (readonly (readonly Node[])[])[]): Node => {
  const row = (cells: readonly (readonly Node[])[], type: string): Node => ({
    type: 'tableRow',
    content: cells.map(cell => ({ type, attrs: {}, content: [paragraph(cell)] })),
  })
  return {
    type: 'table',
    attrs: { isNumberColumnEnabled: false, layout: 'default' },
    content: [row(header, 'tableHeader'), ...rows.map(cells => row(cells, 'tableCell'))],
  }
}

export const properties = (rows: readonly (readonly [string, readonly Node[]])[]): Node => ({
  type: 'table',
  attrs: { isNumberColumnEnabled: false, layout: 'default' },
  content: rows.map(([label, value]) => ({
    type: 'tableRow',
    content: [
      { type: 'tableHeader', attrs: {}, content: [paragraph(text(label))] },
      { type: 'tableCell', attrs: {}, content: [paragraph(value)] },
    ],
  })),
})

export const sidebar = (main: readonly Node[], side: readonly Node[]): Node => ({
  type: 'layoutSection',
  content: [
    { type: 'layoutColumn', attrs: { width: 66.66 }, content: main },
    { type: 'layoutColumn', attrs: { width: 33.33 }, content: side },
  ],
})

export const status = (label: string, color: 'green' | 'neutral' | 'red' | 'yellow'): Node => ({
  type: 'status',
  attrs: { text: label, color },
})

export const date = (value: string): Node => ({ type: 'date', attrs: { timestamp: String(Date.parse(value)) } })

export const anchor = (name: string): Node => ({
  type: 'inlineExtension',
  attrs: {
    extensionType: 'com.atlassian.confluence.macro.core',
    extensionKey: 'anchor',
    parameters: {
      macroParams: { '': { value: name } },
      macroMetadata: { schemaVersion: { value: '1' }, title: 'Anchor' },
    },
  },
})

export const pageHref = (key: string, anchor?: string): string =>
  `docs-sync:page/${encodeURIComponent(key)}${anchor ? `#${anchor}` : ''}`

export const linkMark = (href: string | undefined): Mark[] => (href ? [{ type: 'link', attrs: { href } }] : [])

export const link = (label: string, href: string | undefined): Node[] => text(label, linkMark(href))

export const refLink = (id: string, resolver: Resolver, marks: readonly Mark[] = []): Node[] => {
  const target = resolver.ref(id)
  const label = target?.title ?? id.slice(id.indexOf(':') + 1)
  return text(label, target ? [...marks, { type: 'link', attrs: { href: target.href } }] : marks)
}

export const joined = (parts: readonly (readonly Node[])[], separator = ', '): Node[] =>
  parts.flatMap((part, index) => (index ? [...text(separator), ...part] : [...part]))

export function convert(blocks: readonly Block[], file: string, resolver: Resolver): Node[] {
  const href = (target: string): string | undefined => {
    if (target.startsWith('https://')) return target
    const [path = '', fragment] = target.split('#')
    const page = resolver.path(posix.normalize(posix.join(posix.dirname(file), path)))
    return page && fragment ? `${page}#${fragment}` : page
  }

  const inline = (nodes: readonly Inline[], marks: readonly Mark[] = []): Node[] =>
    nodes.flatMap((node): Node[] => {
      switch (node.type) {
        case 'text':
          return text(node.value, marks)
        case 'code':
          return text(node.value, [...marks.filter(mark => mark.type === 'link'), { type: 'code' }])
        case 'strong':
          return inline(node.children, [...marks, { type: 'strong' }])
        case 'emphasis':
          return inline(node.children, [...marks, { type: 'em' }])
        case 'strike':
          return inline(node.children, [...marks, { type: 'strike' }])
        case 'break':
          return [{ type: 'hardBreak' }]
        case 'link': {
          const target = href(node.href)
          return inline(node.children, target ? [...marks, { type: 'link', attrs: { href: target } }] : marks)
        }
        case 'ref':
          return refLink(node.id, resolver, marks)
      }
    })

  const block = (node: Block): Node[] => {
    switch (node.type) {
      case 'heading':
        return [heading(node.level, inline(node.children))]
      case 'paragraph':
        return [paragraph(inline(node.children))]
      case 'list':
        return [
          {
            type: node.ordered ? 'orderedList' : 'bulletList',
            ...(node.ordered ? { attrs: { order: 1 } } : {}),
            content: node.items.map(item => ({ type: 'listItem', content: item.flatMap(block) })),
          },
        ]
      case 'table': {
        const [header = [], ...rows] = node.rows.map(row => row.map(cell => inline(cell)))
        return [table(header, rows)]
      }
      case 'code':
        return [
          {
            type: 'codeBlock',
            ...(node.language ? { attrs: { language: node.language } } : {}),
            content: text(node.value),
          },
        ]
      case 'callout':
        return [panel(node.kind, node.children.flatMap(block))]
      case 'diagram':
        return diagram(node)
    }
  }

  const diagram = (node: Extract<Block, { type: 'diagram' }>): Node[] => {
    const resolved = resolver.diagram(posix.normalize(posix.join(posix.dirname(file), node.src)))
    if (!resolved) return [paragraph(text(node.caption, [{ type: 'em' }]))]
    if (resolved.kind === 'macro')
      return [
        {
          type: 'extension',
          attrs: {
            layout: 'default',
            extensionType: 'com.atlassian.ecosystem',
            extensionKey: resolved.extensionKey,
            parameters: {
              guestParams: { diagramName: resolved.name, diagramDisplayName: node.caption, pageId: resolved.pageId },
            },
          },
        },
      ]
    return [
      {
        type: 'mediaSingle',
        attrs: { layout: 'center' },
        content: [
          {
            type: 'media',
            attrs: {
              type: 'file',
              id: resolved.id,
              collection: resolved.collection,
              width: resolved.width,
              height: resolved.height,
              alt: node.alt,
            },
          },
          { type: 'caption', content: text(node.caption) },
        ],
      },
    ]
  }

  return blocks.flatMap(block)
}
