import { posix } from 'node:path'
import type { Config } from '../config/schema.ts'
import { humanize } from '../model/text.ts'
import type { Decision, Sources } from '../source/load.ts'
import { catalogKinds, catalogSchemas, linkFields, type CatalogKind } from '../source/schemas.ts'
import {
  anchor,
  bulletList,
  convert,
  date,
  doc,
  heading,
  joined,
  link,
  linkMark,
  pageHref,
  panel,
  paragraph,
  properties,
  refLink,
  sidebar,
  status,
  table,
  text,
  type Node,
  type Resolver,
} from './adf.ts'

export interface RenderedPage {
  readonly key: string
  readonly title: string
  readonly parent?: string
  readonly labels: readonly string[]
  readonly body: Node
  readonly overview?: true
}

const catalogTitles: Record<CatalogKind, string> = {
  requirements: 'Requirements',
  security: 'Security controls',
  logging: 'Logging',
  monitoring: 'Monitoring use cases',
}

export function folderOf(path: string, docs: string): string | undefined {
  const dir = posix.relative(docs, posix.dirname(path))
  return dir && !dir.startsWith('..') ? `${posix.join(docs, dir)}/` : undefined
}

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort()

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(item => typeof item === 'string') : typeof value === 'string' ? [value] : []

const columnName = (key: string): string => {
  const words = key.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const sentence = (value: string): string => (/[.!?]$/.test(value) ? value : `${value}.`)

interface Upstream {
  readonly ref: string
  readonly relation: 'realizes' | 'constrained-by' | 'deviates-from'
  readonly from: string
  readonly note?: string
  readonly reason?: string
}

function upstream(sources: Sources): Upstream[] {
  const links: Upstream[] = []
  const add = (from: string, meta: Readonly<Record<string, unknown>>) => {
    for (const ref of strings(meta['realizes'])) links.push({ ref, relation: 'realizes', from })
    for (const ref of strings(meta['constrained-by'])) links.push({ ref, relation: 'constrained-by', from })
  }
  for (const decision of sources.decisions) {
    add(decision.meta.id, decision.meta)
    for (const deviation of decision.meta['deviates-from'] ?? [])
      links.push({
        ref: deviation.ref,
        relation: 'deviates-from',
        from: decision.meta.id,
        note: `${sentence(deviation.reason)} Approved by ${deviation['approved-by']}.`,
        reason: deviation.reason,
      })
  }
  for (const entry of sources.entries) add(entry.value.id, entry.value)
  return links
}

function decisionPage(
  decision: Decision,
  links: readonly Upstream[],
  resolver: Resolver,
  parent: string,
): RenderedPage {
  const { meta } = decision
  const own = links.filter(item => item.from === meta.id)
  const related = (relation: Upstream['relation']) =>
    joined(own.filter(item => item.relation === relation).map(item => refLink(item.ref, resolver)))
  const banners: Node[] = []
  if (meta['superseded-by'])
    banners.push(panel('info', [paragraph([...text('Replaced by '), ...refLink(meta['superseded-by'], resolver)])]))
  if (meta.retired)
    banners.push(
      panel('error', [
        paragraph([...text('Retired on '), date(meta.retired.date), ...text(`: ${sentence(meta.retired.reason)}`)]),
      ]),
    )
  for (const item of own.filter(link => link.relation === 'deviates-from'))
    banners.push(
      panel('warning', [
        paragraph([
          ...text('Deviates from ', [{ type: 'strong' }]),
          ...refLink(item.ref, resolver, [{ type: 'strong' }]),
        ]),
        paragraph(text(item.note ?? '')),
      ]),
    )
  const rows: [string, Node[]][] = [
    ['Status', [state(decision)]],
    ['Date', [date(meta.date)]],
    ['Decision makers', text(meta['decision-makers'].join(', '))],
  ]
  if (meta.supersedes) rows.push(['Supersedes', refLink(meta.supersedes, resolver)])
  if (own.some(item => item.relation === 'realizes')) rows.push(['Realizes', related('realizes')])
  if (own.some(item => item.relation === 'constrained-by')) rows.push(['Constrained by', related('constrained-by')])
  return {
    key: decision.file,
    title: `${meta.id} ${meta.title}`,
    parent,
    labels: sorted(meta.tags ?? []),
    body: doc([sidebar([...banners, ...convert(decision.blocks, decision.file, resolver)], [properties(rows)])]),
  }
}

const state = (decision: Decision): Node => {
  const { meta } = decision
  if (meta['superseded-by']) return status('Superseded', 'neutral')
  if (meta.retired) return status('Retired', 'red')
  return status('Active', 'green')
}

const summaries: Record<CatalogKind, readonly string[]> = {
  requirements: ['statement', 'priority'],
  security: ['control', 'requirement'],
  logging: ['events', 'destination'],
  monitoring: ['symptom', 'severity'],
}

const priorities = { must: 'red', should: 'yellow', could: 'neutral' } as const

function catalogPage(kind: CatalogKind, entries: Sources['entries'], config: Config, resolver: Resolver): RenderedPage {
  const file = config.catalogs[kind]
  const [primary = ''] = summaries[kind]
  const cell = (key: string, value: unknown): Node[] => {
    const values = strings(value)
    if (key === 'priority') return values.map(item => status(item, priorities[item as keyof typeof priorities]))
    if (['realizes', 'constrained-by', 'requirement', 'covers'].includes(key))
      return joined(values.map(ref => refLink(ref, resolver)))
    if (linkFields[kind].includes(key))
      return joined(
        values.map(target =>
          target.startsWith('https://')
            ? link(target, target)
            : text(target, [{ type: 'code' }, ...linkMark(resolver.path(target))]),
        ),
      )
    if (key === 'applies-to') return joined(values.map(item => text(item, [{ type: 'code' }])))
    return text(values.join(', '))
  }
  const fields = Object.keys(catalogSchemas[kind].shape).filter(key => !['id', 'tags', primary].includes(key))
  return {
    key: file,
    title: catalogTitles[kind],
    labels: sorted(entries.flatMap(entry => entry.value.tags ?? [])),
    body: doc([
      table(
        ['Id', ...summaries[kind]].map(key => text(key === 'id' ? 'Id' : columnName(key))),
        entries.map(entry => [
          link(entry.value.id, pageHref(file, entry.value.id)),
          ...summaries[kind].map(key => cell(key, entry.value[key])),
        ]),
      ),
      heading(2, text('Details')),
      ...entries.flatMap(entry => {
        const present = fields.filter(key => entry.value[key] !== undefined)
        return [
          heading(3, [anchor(entry.value.id), ...text(entry.value.id)]),
          paragraph(cell(primary, entry.value[primary])),
          ...(present.length
            ? [properties(present.map(key => [columnName(key), cell(key, entry.value[key])] as const))]
            : []),
        ]
      }),
    ]),
  }
}

function upstreamTable(links: readonly Upstream[], resolver: Resolver): Node[] {
  if (!links.length) return []
  const by = (ref: string, relation: Upstream['relation']) =>
    joined(
      links
        .filter(item => item.ref === ref && item.relation === relation)
        .map(item => [...refLink(item.from, resolver), ...text(item.reason ? `: ${item.reason}` : '')]),
    )
  return [
    heading(2, text('Upstream decisions')),
    table(
      [text('Upstream decision'), text('Realized by'), text('Constrained'), text('Deviations')],
      sorted(links.map(item => item.ref)).map(ref => [
        refLink(ref, resolver),
        by(ref, 'realizes'),
        by(ref, 'constrained-by'),
        by(ref, 'deviates-from'),
      ]),
    ),
  ]
}

export function renderPages(config: Config, sources: Sources, resolver: Resolver): RenderedPage[] {
  const links = upstream(sources)
  const pages: RenderedPage[] = sources.pages.map(page => {
    const parent = folderOf(page.file, config.docs)
    return {
      key: page.file,
      title: page.meta.title,
      ...(parent ? { parent } : {}),
      labels: sorted(page.meta.tags ?? []),
      body: doc(convert(page.blocks, page.file, resolver)),
    }
  })

  if (sources.decisions.length) {
    const section = `${config.decisions.folder}/`
    const decisions = [...sources.decisions].sort((a, b) => a.meta.id.localeCompare(b.meta.id))
    pages.push({
      key: config.decisions.folder,
      title: `${humanize(posix.basename(config.decisions.folder))} overview`,
      parent: section,
      overview: true,
      labels: [],
      body: doc([
        table(
          [text('Id'), text('Decision'), text('Date'), text('Status')],
          decisions.map(decision => [
            text(decision.meta.id),
            link(decision.meta.title, pageHref(decision.file)),
            [date(decision.meta.date)],
            [state(decision)],
          ]),
        ),
        ...upstreamTable(links, resolver),
      ]),
    })
    pages.push(...decisions.map(decision => decisionPage(decision, links, resolver, section)))
  }

  for (const kind of catalogKinds) {
    const entries = sources.entries.filter(entry => entry.catalog === kind)
    if (entries.length) pages.push(catalogPage(kind, entries, config, resolver))
  }
  return withOverviews(pages, config.docs)
}

const overviewFiles = new Set(['overview.md', 'index.md', 'readme.md'])

function withOverviews(pages: readonly RenderedPage[], docs: string): RenderedPage[] {
  const marked = pages.map(page =>
    overviewFiles.has(posix.basename(page.key).toLowerCase()) ? { ...page, overview: true as const } : page,
  )
  const folders = new Set<string>()
  for (const page of marked)
    for (let key = page.parent; key && !folders.has(key); key = folderOf(key, docs)) folders.add(key)
  const overviewOf = new Map(
    [...folders].map(folder => [
      folder,
      marked.find(page => page.parent === folder && page.overview)?.key ?? folder.slice(0, -1),
    ]),
  )
  const generated = [...folders]
    .filter(folder => !marked.some(page => page.parent === folder && page.overview))
    .sort()
    .map(folder => {
      const subfolders = [...folders].filter(other => folderOf(other, docs) === folder).sort()
      const children = marked
        .filter(page => page.parent === folder)
        .sort((a, b) => a.title.localeCompare(b.title))
        .map(page => link(page.title, pageHref(page.key)))
      return {
        key: folder.slice(0, -1),
        title: `${humanize(posix.basename(folder))} overview`,
        parent: folder,
        overview: true as const,
        labels: [],
        body: doc([
          bulletList(
            [
              ...subfolders.map(sub => link(humanize(posix.basename(sub)), pageHref(overviewOf.get(sub) ?? ''))),
              ...children,
            ].map(item => [paragraph(item)]),
          ),
        ]),
      }
    })
  return [...marked, ...generated]
}
