import type { Config } from '../config/schema.ts'
import type { Node, Reader } from '../confluence/reader.ts'
import { error, warning, type Finding } from '../findings.ts'

export interface Use {
  readonly ref: string
  readonly file: string
  readonly line: number
}

export interface Resolved {
  readonly page: string
  readonly title: string
  readonly href: string
  readonly state?: string
}

type Source = Config['reference-sources'][string]

const quote = (value: string) => `"${value.replace(/["\\]/g, '\\$&')}"`

async function folderId(reader: Reader, space: string, path: string): Promise<string | string[]> {
  const [first = '', ...rest] = path
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)
  const roots = (await reader.search(`space=${quote(space)} and type=folder and title=${quote(first)}`)).filter(
    node => node.title === first,
  )
  if (roots.length !== 1) return roots.map(node => node.id)
  let id = roots[0]?.id ?? ''
  for (const segment of rest) {
    const next = (await reader.children(id)).filter(node => node.type === 'folder' && node.title === segment)
    if (next.length !== 1) return next.map(node => node.id)
    id = next[0]?.id ?? ''
  }
  return id
}

async function candidates(reader: Reader, source: Source, folder: string, id: string): Promise<Node[]> {
  const scope = `space=${quote(source.space)} and type=page and ancestor=${folder}`
  if (source.match === 'label') return reader.search(`${scope} and label=${quote(id.toLowerCase())}`)
  const prefix = new RegExp(`^(?:${source['id-pattern']})(?![\\w-])`, 'u')
  return (await reader.search(`${scope} and title ~ ${quote(id)}`)).filter(node => prefix.exec(node.title)?.[0] === id)
}

async function state(reader: Reader, source: Source, pageId: string): Promise<string | undefined> {
  const rules = Object.entries(source.lifecycle ?? {})
  if (!rules.length) return undefined
  const page = await reader.item('page', pageId)
  const folder =
    page?.parentType === 'folder' && page.parentId ? (await reader.item('folder', page.parentId))?.title : undefined
  const labels = rules.some(([, rule]) => 'label' in rule) ? await reader.labels(pageId) : []
  return rules.find(([, rule]) => ('folder' in rule ? rule.folder === folder : labels.includes(rule.label)))?.[0]
}

export async function resolveRefs(
  reader: Reader,
  config: Config,
  uses: readonly Use[],
  configFile: string,
): Promise<{ resolved: Map<string, Resolved>; findings: Finding[] }> {
  const resolved = new Map<string, Resolved>()
  const findings: Finding[] = []
  const first = new Map<string, Use>()
  for (const use of uses) if (use.ref.includes(':') && !first.has(use.ref)) first.set(use.ref, use)
  const byPrefix = Map.groupBy(first.values(), use => use.ref.slice(0, use.ref.indexOf(':')))
  for (const [prefix, group] of byPrefix) {
    const source = config['reference-sources'][prefix]
    if (!source) continue
    if (source.match === 'page-property') {
      findings.push(
        error('refs/match', configFile, 1, `match: page-property is not supported yet (source "${prefix}")`),
      )
      continue
    }
    const folder = await folderId(reader, source.space, source.folder)
    if (typeof folder !== 'string') {
      const problem = folder.length ? `matches ${String(folder.length)} folders` : 'was not found'
      findings.push(error('refs/folder', configFile, 1, `Folder "${source.folder}" in ${source.space} ${problem}`))
      continue
    }
    for (const use of group) {
      const id = use.ref.slice(prefix.length + 1)
      const pages = await candidates(reader, source, folder, id)
      const [page] = pages
      if (!page || pages.length > 1) {
        const problem = page
          ? `matches ${String(pages.length)} pages (${pages.map(p => p.id).join(', ')})`
          : 'not found'
        findings.push(error('refs/resolve', use.file, use.line, `${use.ref} ${problem} in ${source.space}`))
        continue
      }
      const current = await state(reader, source, page.id)
      if (current) findings.push(warning('refs/state', use.file, use.line, `${use.ref} is ${current}`))
      resolved.set(use.ref, {
        page: page.id,
        title: page.title,
        href: `https://${config.confluence.site}/wiki/spaces/${source.space}/pages/${page.id}`,
        ...(current ? { state: current } : {}),
      })
    }
  }
  return { resolved, findings }
}
