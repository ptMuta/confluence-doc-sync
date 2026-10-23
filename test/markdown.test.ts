import { describe, expect, it } from 'vitest'
import { parseMarkdown, safeHref } from '../src/markdown/parse.ts'
import { inlineText, spans } from '../src/model/text.ts'

const parse = (text: string) => parseMarkdown(text, 'a.md', 5)

describe('parseMarkdown', () => {
  it('builds the internal model', () => {
    const { blocks, findings } = parse(
      'Some *em* **strong** ~~gone~~ `code`  \nnext [[DEC-0001]] [x](https://example.com)\n\n1. one\n\n```ts\nconst a = 1\n```\n\n```\nplain\n```\n',
    )
    expect(findings).toEqual([])
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        line: 5,
        children: [
          { type: 'text', value: 'Some ' },
          { type: 'emphasis', children: [{ type: 'text', value: 'em' }] },
          { type: 'text', value: ' ' },
          { type: 'strong', children: [{ type: 'text', value: 'strong' }] },
          { type: 'text', value: ' ' },
          { type: 'strike', children: [{ type: 'text', value: 'gone' }] },
          { type: 'text', value: ' ' },
          { type: 'code', value: 'code' },
          { type: 'break' },
          { type: 'text', value: 'next ' },
          { type: 'ref', id: 'DEC-0001' },
          { type: 'text', value: ' ' },
          { type: 'link', href: 'https://example.com', children: [{ type: 'text', value: 'x' }] },
        ],
      },
      {
        type: 'list',
        ordered: true,
        line: 8,
        items: [[{ type: 'paragraph', line: 8, children: [{ type: 'text', value: 'one' }] }]],
      },
      { type: 'code', language: 'ts', value: 'const a = 1', line: 10 },
      { type: 'code', value: 'plain', line: 14 },
    ])
    expect(inlineText(blocks[0]?.type === 'paragraph' ? blocks[0].children : [])).toBe(
      'Some em strong gone code next [[DEC-0001]] x',
    )
  })

  it('reads callouts', () => {
    const { blocks, findings } = parse('> [!WARNING]\n> Careful.\n>\n> More.\n\n> [!NOTE]\n\n> [!NOTE]\n> Inline\n')
    expect(findings).toEqual([])
    expect(
      blocks.map(block => (block.type === 'callout' ? [block.kind, [...spans(block.children)].length] : [])),
    ).toEqual([
      ['warning', 2],
      ['info', 0],
      ['info', 1],
    ])
  })

  it('refuses everything outside the subset', () => {
    const { findings } = parse(
      'Text[^1]\n\n[^1]: Note\n\n---\n\n[ref]: https://example.com\n\nA ![x](a.drawio "c") inline\n\n[a][ref]\n',
    )
    expect(findings.map(f => f.message)).toEqual([
      'A footnote is not supported',
      'A footnote is not supported',
      'A horizontal rule is not supported',
      'A link definition is not supported',
      'An image inside text is not supported',
      'A reference-style link is not supported',
    ])
  })

  it('checks link schemes', () => {
    expect(['https://a', 'docs/a.md', '#top', '../a.md'].every(safeHref)).toBe(true)
    expect(['http://a', 'javascript:alert(1)', '//evil.example', 'mailto:a@b'].some(safeHref)).toBe(false)
  })
})
