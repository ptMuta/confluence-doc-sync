import { hasIcon, inlineIcon, tileIcon } from './icons.ts'
import type { Cell, Page } from './parse.ts'
import { formatStyle } from './style.ts'
import type { Theme } from './theme.ts'
import { element, type XNode } from './xml.ts'

export interface Problem {
  readonly rule: 'diagrams/icon' | 'diagrams/role' | 'diagrams/style' | 'diagrams/unsafe'
  readonly severity: 'error' | 'warning'
  readonly message: string
}

const geometryAttrs: Readonly<Record<string, readonly string[]>> = {
  mxGeometry: ['x', 'y', 'width', 'height', 'relative', 'as'],
  mxPoint: ['x', 'y', 'as'],
  Array: ['as'],
  mxRectangle: ['x', 'y', 'width', 'height', 'as'],
}

const modelAttrs = [
  'dx',
  'dy',
  'grid',
  'gridSize',
  'guides',
  'tooltips',
  'connect',
  'arrows',
  'fold',
  'page',
  'pageScale',
  'pageWidth',
  'pageHeight',
]

const managed = ['fontFamily', 'fontSize', 'fontColor']

const safeImage = /^data:image\/(?:png|jpeg|gif|webp)[,;]|^img\/lib\/[\w/-]+\.svg$/

function geometry(node: XNode): string {
  const allowed = geometryAttrs[node.tag]
  if (!allowed) return ''
  const attrs = Object.fromEntries(allowed.map(key => [key, node.attrs[key]]))
  return element(node.tag, attrs, node.children.map(geometry).join(''))
}

const plain = (html: string): string =>
  html
    .replace(/<br\s*\/?>|<(?:div|p|li)(?:\s[^>]*)?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/^\n+|\n+$/g, '')

function scripted(html: string): boolean {
  const lower = html.toLowerCase()
  const tags = lower.match(/<[^>]+>/g) ?? []
  return (
    lower.includes('javascript:') ||
    tags.some(
      tag =>
        tag.startsWith('<script') ||
        tag
          .split(/\s+/)
          .slice(1)
          .some(attr => attr.startsWith('on')),
    )
  )
}

function applyIcon(
  style: Map<string, string | undefined>,
  role: string | undefined,
): [Problem['severity'], string] | undefined {
  const icon = style.get('icon')
  const color = style.get('iconColor') ?? style.get('strokeColor') ?? style.get('fontColor') ?? '#000000'
  const tile = { fill: style.get('tileFill') ?? 'none', stroke: style.get('tileStroke') ?? 'none', color }
  for (const key of ['icon', 'iconColor', 'tileFill', 'tileStroke']) style.delete(key)
  if (icon === undefined) return undefined
  if (!hasIcon(icon)) return ['error', `unknown icon "${icon}"; see https://tabler.io/icons`]
  if (role === 'icon') {
    style.set('shape', 'image')
    style.set('image', tileIcon(icon, { ...tile, radius: Number(style.get('arcSize') ?? '14') }))
    return undefined
  }
  if (style.has('shape')) return ['warning', `role "${String(role)}" has its own shape, so the icon is not shown`]
  style.set('shape', 'label')
  style.set('image', inlineIcon(icon, color))
  style.set('imageWidth', '20')
  style.set('imageHeight', '20')
  style.set('imageAlign', 'left')
  style.set('imageVerticalAlign', 'middle')
  style.set('spacingLeft', '30')
  return undefined
}

const roleOf = (cell: Cell): string | undefined =>
  cell.style.get('role') ?? (cell.edge ? 'flow' : cell.style.has('text') ? 'text' : undefined)

function prepareCell(cell: Cell, theme: Theme, problems: Problem[]): string {
  const problem = (rule: Problem['rule'], severity: Problem['severity'], message: string) =>
    problems.push({ rule, severity, message: `Cell ${cell.id}: ${message}` })
  const style = new Map(cell.style)
  const drawn = cell.vertex || cell.edge
  const role = roleOf(cell)
  const themed = role === undefined ? undefined : theme.roles[role]
  if (drawn && role === undefined) problem('diagrams/role', 'error', 'set a role in its style, e.g. role=service')
  else if (drawn && role !== undefined && !themed) problem('diagrams/role', 'error', `unknown role "${role}"`)

  if (cell.html && scripted(cell.value)) problem('diagrams/unsafe', 'error', 'label has script content')
  const image = style.get('image')
  if (image !== undefined && !safeImage.test(image)) {
    problem(
      'diagrams/unsafe',
      'error',
      'images must be embedded PNG, JPEG, GIF or WebP data, or built-in draw.io icons',
    )
    style.delete('image')
  }
  if (cell.link !== undefined && !cell.link.startsWith('https://'))
    problem('diagrams/unsafe', 'error', `link "${cell.link}" must use https`)
  style.delete('html')

  if (drawn) {
    const wanted = {
      fontFamily: theme.font.family,
      fontSize: String(theme.font.size),
      fontColor: theme.font.color,
      ...themed,
    }
    const overridden = Object.entries(wanted)
      .filter(
        ([key, value]) =>
          style.has(key) && style.get(key) !== value && (key in (themed ?? {}) || managed.includes(key)),
      )
      .map(([key]) => key)
    if (overridden.length) problem('diagrams/style', 'warning', `the theme replaces ${overridden.join(', ')}`)
    for (const [key, value] of Object.entries(wanted)) style.set(key, value === '' ? undefined : value)
    const iconProblem = applyIcon(style, role)
    if (iconProblem) problem('diagrams/icon', ...iconProblem)
  }

  const attrs = {
    id: cell.id,
    style: style.size ? formatStyle(style) : undefined,
    vertex: cell.vertex ? '1' : undefined,
    edge: cell.edge ? '1' : undefined,
    parent: cell.parent,
    source: cell.source,
    target: cell.target,
  }
  const value = cell.html ? plain(cell.value) : cell.value
  const link = cell.link?.startsWith('https://') ? cell.link : undefined
  const inner = cell.geometry ? geometry(cell.geometry) : ''
  if (link)
    return element(
      'UserObject',
      { label: value, link, id: cell.id },
      element('mxCell', { ...attrs, id: undefined }, inner),
    )
  return element('mxCell', { ...attrs, value: value || undefined }, inner)
}

export function prepare(page: Page, theme: Theme): { xml: string; problems: Problem[] } {
  const problems: Problem[] = []
  const cells = page.cells.map(cell => prepareCell(cell, theme, problems)).join('')
  const model = Object.fromEntries(modelAttrs.map(key => [key, page.model[key]]))
  const graph = element('mxGraphModel', { ...model, background: theme.background }, element('root', {}, cells))
  return { xml: element('mxfile', {}, element('diagram', { id: page.id, name: page.name }, graph)), problems }
}
