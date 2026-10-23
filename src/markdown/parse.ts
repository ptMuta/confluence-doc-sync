import type { Blockquote, Image, Nodes, PhrasingContent, RootContent } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { error, type Finding } from '../findings.ts'
import type { Block, Inline } from '../model/types.ts'

const parser = unified().use(remarkParse).use(remarkGfm)

const names: Partial<Record<string, string>> = {
  html: 'Raw HTML',
  footnoteDefinition: 'A footnote',
  footnoteReference: 'A footnote',
  definition: 'A link definition',
  linkReference: 'A reference-style link',
  imageReference: 'A reference-style image',
  thematicBreak: 'A horizontal rule',
  image: 'An image inside text',
  blockquote: 'A quote that is not a NOTE or WARNING callout',
}

const callouts = { NOTE: 'info', WARNING: 'warning' } as const

export const safeHref = (href: string): boolean =>
  href.startsWith('https://') || (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('//'))

function splitRefs(value: string): Inline[] {
  return value
    .split(/\[\[([^\]\s]+)\]\]/)
    .flatMap((part, index): Inline[] =>
      index % 2 ? [{ type: 'ref', id: part }] : part ? [{ type: 'text', value: part }] : [],
    )
}

export function parseMarkdown(text: string, file: string, firstLine = 1): { blocks: Block[]; findings: Finding[] } {
  const findings: Finding[] = []
  const lineOf = (node: Nodes) => (node.position?.start.line ?? 1) + firstLine - 1
  const refuse = (node: Nodes) => {
    findings.push(
      error('markdown/unsupported', file, lineOf(node), `${names[node.type] ?? `"${node.type}"`} is not supported`),
    )
  }

  const inline = (nodes: readonly PhrasingContent[]): Inline[] =>
    nodes.flatMap((node): Inline[] => {
      switch (node.type) {
        case 'text':
          return splitRefs(node.value)
        case 'strong':
        case 'emphasis':
          return [{ type: node.type, children: inline(node.children) }]
        case 'delete':
          return [{ type: 'strike', children: inline(node.children) }]
        case 'inlineCode':
          return [{ type: 'code', value: node.value }]
        case 'break':
          return [{ type: 'break' }]
        case 'link':
          if (!safeHref(node.url))
            findings.push(
              error('markdown/link', file, lineOf(node), `Link "${node.url}" must use https or a repository path`),
            )
          return [{ type: 'link', href: node.url, children: inline(node.children) }]
        default:
          refuse(node)
          return []
      }
    })

  const diagram = (node: Image, line: number): Block => {
    const src = node.url
    const alt = node.alt?.trim() ?? ''
    const caption = node.title?.trim() ?? ''
    if (!src.endsWith('.drawio') || !safeHref(src) || src.startsWith('https://'))
      findings.push(error('markdown/diagram', file, line, 'Images must point at a .drawio file in the repository'))
    if (!alt || !caption)
      findings.push(
        error('markdown/diagram', file, line, 'Diagrams need alt text and a caption: ![alt](file.drawio "Caption")'),
      )
    return { type: 'diagram', src, alt, caption, line }
  }

  const callout = (node: Blockquote, line: number): Block[] => {
    const [first, ...rest] = node.children
    const head = first?.type === 'paragraph' ? first.children[0] : undefined
    const match = head?.type === 'text' ? /^\[!(NOTE|WARNING)\][ \t]*(?:\r?\n|$)/.exec(head.value) : null
    if (!match || first?.type !== 'paragraph' || head?.type !== 'text') {
      refuse(node)
      return []
    }
    const remainder = head.value.slice(match[0].length)
    const children = [...(remainder ? [{ ...head, value: remainder }] : []), ...first.children.slice(1)]
    const blocks = [
      ...(children.length ? [{ type: 'paragraph' as const, children: inline(children), line }] : []),
      ...rest.flatMap(block),
    ]
    return [{ type: 'callout', kind: callouts[match[1] as keyof typeof callouts], children: blocks, line }]
  }

  const block = (node: RootContent): Block[] => {
    const line = lineOf(node)
    switch (node.type) {
      case 'heading':
        return [{ type: 'heading', level: node.depth, children: inline(node.children), line }]
      case 'paragraph': {
        const [only] = node.children
        if (only?.type === 'image' && node.children.length === 1) return [diagram(only, line)]
        return [{ type: 'paragraph', children: inline(node.children), line }]
      }
      case 'list':
        return [
          {
            type: 'list',
            ordered: node.ordered === true,
            items: node.children.map(item => {
              if (typeof item.checked === 'boolean')
                findings.push(error('markdown/unsupported', file, lineOf(item), 'A task list item is not supported'))
              return item.children.flatMap(block)
            }),
            line,
          },
        ]
      case 'table':
        return [
          { type: 'table', rows: node.children.map(row => row.children.map(cell => inline(cell.children))), line },
        ]
      case 'code':
        return [{ type: 'code', ...(node.lang ? { language: node.lang } : {}), value: node.value, line }]
      case 'blockquote':
        return callout(node, line)
      default:
        refuse(node)
        return []
    }
  }

  const tree = parser.parse(text)
  return { blocks: tree.children.flatMap(block), findings }
}
