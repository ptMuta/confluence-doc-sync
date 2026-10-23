import type { Config } from '../config/schema.ts'
import type { Decision, Sources } from '../source/load.ts'
import { catalogKinds, catalogSchemas, linkFields, type CatalogKind } from '../source/schemas.ts'
import {
  anchor,
  bulletList,
  convert,
  doc,
  joined,
  link,
  panel,
  paragraph,
  refLink,
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
}

const catalogTitles: Record<CatalogKind, string> = {
  requirements: 'Requirements',
  security: 'Security controls',
  logging: 'Logging',
  monitoring: 'Monitoring use cases',
}

const label = (value: string): string => value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort()

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(item => typeof item === 'string') : typeof value === 'string' ? [value] : []

const columnName = (key: string): string => {
  const words = key.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

interface Upstream {
  readonly ref: string
  readonly relation: 'realizes' | 'constrained-by' | 'deviates-from'
  readonly from: string
  readonly note?: string
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
        note: `${deviation.reason} (approved by ${deviation['approved-by']})`,
      })
  }
  for (const entry of sources.entries) add(entry.value.id, entry.value)
  return links
}

const relations = { realizes: 'Realizes', 'constrained-by': 'Constrained by', 'deviates-from': 'Deviates from' }

function decisionPage(
  decision: Decision,
  links: readonly Upstream[],
  resolver: Resolver,
  parent: string,
): RenderedPage {
  const { meta } = decision
  const own = links.filter(item => item.from === meta.id)
  const content: Node[] = []
  if (own.length)
    content.push(
      panel('info', [
        paragraph(text('Upstream decisions', [{ type: 'strong' }])),
        bulletList(
          own.map(item => [
            paragraph([
              ...text(`${relations[item.relation]} `),
              ...refLink(item.ref, resolver),
              ...text(item.note ? `: ${item.note}` : ''),
            ]),
          ]),
        ),
      ]),
    )
  if (meta['superseded-by'])
    content.push(
      panel('warning', [paragraph([...text('Superseded by '), ...refLink(meta['superseded-by'], resolver)])]),
    )
  if (meta.retired)
    content.push(panel('warning', [paragraph(text(`Retired on ${meta.retired.date}: ${meta.retired.reason}`))]))
  content.push(
    paragraph([
      ...text(`Date: ${meta.date} · Decision makers: ${meta['decision-makers'].join(', ')}`),
      ...(meta.supersedes ? [...text(' · Supersedes '), ...refLink(meta.supersedes, resolver)] : []),
    ]),
    ...convert(decision.blocks, decision.file, resolver),
  )
  return {
    key: decision.file,
    title: `${meta.id} ${meta.title}`,
    parent,
    labels: sorted([...(meta.tags ?? []), ...own.map(item => label(item.ref))]),
    body: doc(content),
  }
}

const state = (decision: Decision, resolver: Resolver): Node[] => {
  const { meta } = decision
  if (meta['superseded-by']) return [...text('Superseded by '), ...refLink(meta['superseded-by'], resolver)]
  if (meta.retired) return text(`Retired ${meta.retired.date}`)
  return text('In force')
}

function catalogPage(kind: CatalogKind, entries: Sources['entries'], config: Config, resolver: Resolver): RenderedPage {
  const fields = Object.keys(catalogSchemas[kind].shape).filter(
    key => key !== 'tags' && entries.some(entry => entry.value[key] !== undefined),
  )
  const cell = (key: string, value: unknown): Node[] => {
    const values = strings(value)
    if (key === 'id') return [anchor(values.join('')), ...text(values.join(''))]
    if (['realizes', 'constrained-by', 'requirement', 'covers'].includes(key))
      return joined(values.map(ref => refLink(ref, resolver)))
    if (linkFields[kind].includes(key))
      return joined(values.map(target => link(target, target.startsWith('https://') ? target : resolver.path(target))))
    return text(values.join(', '))
  }
  const file = config.catalogs[kind]
  return {
    key: file,
    title: `${config.system}: ${catalogTitles[kind]}`,
    labels: sorted(
      entries.flatMap(entry => [
        ...(entry.value.tags ?? []),
        ...[...strings(entry.value['realizes']), ...strings(entry.value['constrained-by'])].map(label),
      ]),
    ),
    body: doc([
      table(
        fields.map(key => text(key === 'id' ? 'Id' : columnName(key))),
        entries.map(entry => fields.map(key => cell(key, entry.value[key]))),
      ),
    ]),
  }
}

export function renderPages(config: Config, sources: Sources, resolver: Resolver): RenderedPage[] {
  const links = upstream(sources)
  const pages: RenderedPage[] = sources.pages.map(page => ({
    key: page.file,
    title: page.meta.title,
    labels: sorted(page.meta.tags ?? []),
    body: doc(convert(page.blocks, page.file, resolver)),
  }))

  if (sources.decisions.length) {
    const section = config.decisions.folder
    const decisions = [...sources.decisions].sort((a, b) => a.meta.id.localeCompare(b.meta.id))
    pages.push({
      key: section,
      title: `${config.system}: ${config.decisions.label}s`,
      labels: [],
      body: doc([
        table(
          [text('Id'), text('Title'), text('Date'), text('State')],
          decisions.map(decision => [
            refLink(decision.meta.id, resolver),
            text(decision.meta.title),
            text(decision.meta.date),
            state(decision, resolver),
          ]),
        ),
      ]),
    })
    pages.push(...decisions.map(decision => decisionPage(decision, links, resolver, section)))
  }

  for (const kind of catalogKinds) {
    const entries = sources.entries.filter(entry => entry.catalog === kind)
    if (entries.length) pages.push(catalogPage(kind, entries, config, resolver))
  }

  if (links.length) {
    const refs = sorted(links.map(item => item.ref))
    const by = (ref: string, relation: Upstream['relation']) =>
      joined(
        links
          .filter(item => item.ref === ref && item.relation === relation)
          .map(item => [...refLink(item.from, resolver), ...text(item.note ? ` (${item.note})` : '')]),
      )
    pages.push({
      key: 'coverage',
      title: `${config.system}: Upstream decisions`,
      labels: [],
      body: doc([
        table(
          [text('Upstream decision'), text('Realized by'), text('Constrained'), text('Deviations')],
          refs.map(ref => [
            refLink(ref, resolver),
            by(ref, 'realizes'),
            by(ref, 'constrained-by'),
            by(ref, 'deviates-from'),
          ]),
        ),
      ]),
    })
  }
  return pages
}
