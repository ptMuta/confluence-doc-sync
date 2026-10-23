import outline from '../../node_modules/@tabler/icons/tabler-nodes-outline.json' with { type: 'json' }
import { element } from './xml.ts'

type Node = [string, Record<string, string>]

const glyphs: Readonly<Record<string, readonly Node[] | undefined>> = outline as unknown as Record<string, Node[]>

export const hasIcon = (name: string): boolean => Object.hasOwn(glyphs, name)

const dataUri = (svg: string): string => `data:image/svg+xml,${Buffer.from(svg).toString('base64')}`

function glyph(name: string, color: string, transform: string): string {
  const paths = (glyphs[name] ?? []).map(([tag, attrs]) => element(tag, attrs, ''))
  return element(
    'g',
    {
      transform,
      fill: 'none',
      stroke: color,
      'stroke-width': '1.75',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
    paths.join(''),
  )
}

const svg = (size: number, body: string): string =>
  element(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width: String(size),
      height: String(size),
      viewBox: `0 0 ${String(size)} ${String(size)}`,
    },
    body,
  )

export interface Tile {
  readonly fill: string
  readonly stroke: string
  readonly color: string
  readonly radius: number
}

export const tileIcon = (name: string, tile: Tile): string =>
  dataUri(
    svg(
      64,
      element('rect', {
        x: '1',
        y: '1',
        width: '62',
        height: '62',
        rx: String(tile.radius),
        fill: tile.fill,
        stroke: tile.stroke,
        'stroke-width': '2',
      }) + glyph(name, tile.color, 'translate(14 14) scale(1.5)'),
    ),
  )

export const inlineIcon = (name: string, color: string): string => dataUri(svg(24, glyph(name, color, '')))
