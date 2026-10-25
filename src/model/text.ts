import type { Block, Inline } from './types.ts'

export interface Span {
  readonly inlines: readonly Inline[]
  readonly line: number
}

export const inlineText = (nodes: readonly Inline[]): string =>
  nodes
    .map(node => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.value
        case 'ref':
          return `[[${node.id}]]`
        case 'break':
          return ' '
        default:
          return inlineText(node.children)
      }
    })
    .join('')

export function* spans(blocks: readonly Block[]): Generator<Span> {
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        yield { inlines: block.children, line: block.line }
        break
      case 'list':
        for (const item of block.items) yield* spans(item)
        break
      case 'table':
        for (const row of block.rows) for (const cell of row) yield { inlines: cell, line: block.line }
        break
      case 'callout':
        yield* spans(block.children)
        break
      default:
        break
    }
  }
}

export function* inlines(nodes: readonly Inline[]): Generator<Inline> {
  for (const node of nodes) {
    yield node
    if ('children' in node) yield* inlines(node.children)
  }
}

export function* diagrams(blocks: readonly Block[]): Generator<Extract<Block, { type: 'diagram' }>> {
  for (const block of blocks) {
    if (block.type === 'diagram') yield block
    else if (block.type === 'list') for (const item of block.items) yield* diagrams(item)
    else if (block.type === 'callout') yield* diagrams(block.children)
  }
}

export const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []

export const humanize = (name: string): string => {
  const words = name.replace(/\.md$/, '').replace(/[-_]+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
