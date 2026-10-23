import { inflateRawSync } from 'node:zlib'
import { parseStyle } from './style.ts'
import { parseXml, type XNode } from './xml.ts'

export interface Cell {
  readonly id: string
  readonly value: string
  readonly html: boolean
  readonly style: ReadonlyMap<string, string | undefined>
  readonly vertex: boolean
  readonly edge: boolean
  readonly parent?: string
  readonly source?: string
  readonly target?: string
  readonly link?: string
  readonly geometry?: XNode
}

export interface Page {
  readonly id: string
  readonly name: string
  readonly model: Readonly<Record<string, string>>
  readonly cells: readonly Cell[]
}

const maxCells = 10_000

function modelOf(diagram: XNode, maxBytes: number): XNode {
  const model = diagram.children.find(child => child.tag === 'mxGraphModel')
  if (model) return model
  const packed = diagram.text.trim()
  if (!packed) throw new Error('A page has no content')
  const inflated = inflateRawSync(Buffer.from(packed, 'base64'), { maxOutputLength: maxBytes }).toString('utf8')
  const inner = parseXml(decodeURIComponent(inflated))
  if (inner.tag !== 'mxGraphModel') throw new Error('A compressed page does not hold a graph model')
  return inner
}

function cellOf(node: XNode): Cell {
  const wrapped = node.tag === 'mxCell' ? undefined : node
  const cell = wrapped ? wrapped.children.find(child => child.tag === 'mxCell') : node
  const attrs = { ...cell?.attrs, ...wrapped?.attrs }
  const id = attrs['id']
  if (!id) throw new Error('A cell has no id')
  const style = parseStyle(attrs['style'] ?? '')
  const geometry = cell?.children.find(child => child.tag === 'mxGeometry')
  return {
    id,
    value: (wrapped ? attrs['label'] : attrs['value']) ?? '',
    html: style.get('html') === '1',
    style,
    vertex: attrs['vertex'] === '1',
    edge: attrs['edge'] === '1',
    ...(attrs['parent'] ? { parent: attrs['parent'] } : {}),
    ...(attrs['source'] ? { source: attrs['source'] } : {}),
    ...(attrs['target'] ? { target: attrs['target'] } : {}),
    ...(attrs['link'] ? { link: attrs['link'] } : {}),
    ...(geometry ? { geometry } : {}),
  }
}

export function parseDrawio(text: string, maxBytes = 50_000_000): Page[] {
  const root = parseXml(text)
  const diagrams = root.tag === 'mxfile' ? root.children.filter(child => child.tag === 'diagram') : []
  const pages = root.tag === 'mxGraphModel' ? [{ tag: 'diagram', attrs: {}, children: [root], text: '' }] : diagrams
  if (!pages.length) throw new Error('The file has no draw.io pages')
  let total = 0
  return pages.map((diagram, index) => {
    const model = modelOf(diagram, maxBytes)
    const cells = (model.children.find(child => child.tag === 'root')?.children ?? []).map(cellOf)
    total += cells.length
    if (total > maxCells) throw new Error(`The file has more than ${String(maxCells)} cells`)
    return {
      id: diagram.attrs['id'] ?? `page-${String(index + 1)}`,
      name: diagram.attrs['name'] ?? `Page ${String(index + 1)}`,
      model: model.attrs,
      cells,
    }
  })
}
