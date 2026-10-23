import type { Cell, Page } from './parse.ts'
import { formatStyle } from './style.ts'
import type { Theme } from './theme.ts'
import { element, type XNode } from './xml.ts'

export interface Problem {
  readonly rule: 'diagrams/role' | 'diagrams/style' | 'diagrams/unsafe'
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

const safeImage = /^data:image\/(?:png|jpeg|gif|webp)[,;]/

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
    problem('diagrams/unsafe', 'error', 'images must be embedded PNG, JPEG, GIF or WebP data')
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
