import { z } from 'zod'
import type { Config } from '../config/schema.ts'
import { error, type Finding } from '../findings.ts'
import { parseMarkdown } from '../markdown/parse.ts'
import { humanize, inlineText } from '../model/text.ts'
import type { Block } from '../model/types.ts'
import { listFiles, readText } from './files.ts'
import { splitFrontMatter } from './frontmatter.ts'
import {
  catalogKinds,
  catalogSchemas,
  decisionSchema,
  pageSchema,
  type CatalogKind,
  type DecisionMeta,
  type PageMeta,
} from './schemas.ts'
import { isFinding, parseYaml, validate } from './yaml.ts'

type LineOf = (path: readonly PropertyKey[]) => number

interface Document<K extends string, M> {
  readonly kind: K
  readonly file: string
  readonly meta: M
  readonly lineOf: LineOf
  readonly blocks: readonly Block[]
}

export type Page = Document<'page', PageMeta>
export type Decision = Document<'decision', DecisionMeta>

interface Entry {
  readonly catalog: CatalogKind
  readonly file: string
  readonly value: Readonly<Record<string, unknown>> & {
    readonly id: string
    readonly tags?: readonly string[] | undefined
  }
  readonly line: number
  readonly lineOf: LineOf
}

export interface Sources {
  readonly pages: readonly Page[]
  readonly decisions: readonly Decision[]
  readonly entries: readonly Entry[]
  readonly diagrams: readonly string[]
  readonly texts: readonly { readonly file: string; readonly text: string }[]
}

const under = (file: string, dir: string): boolean => file.startsWith(`${dir.replace(/\/+$/, '')}/`)

function titled(file: string, meta: z.output<typeof pageSchema>, blocks: readonly Block[]) {
  const [first, ...rest] = blocks
  if (meta.title) return { meta: { ...meta, title: meta.title }, blocks }
  if (first?.type === 'heading' && first.level === 1)
    return { meta: { ...meta, title: inlineText(first.children).trim() }, blocks: rest }
  return { meta: { ...meta, title: humanize(file.split('/').at(-1) ?? file) }, blocks }
}

export async function loadSources(root: string, config: Config): Promise<{ sources: Sources; findings: Finding[] }> {
  const findings: Finding[] = []
  const pages: Page[] = []
  const decisions: Decision[] = []
  const entries: Entry[] = []
  const texts: { file: string; text: string }[] = []
  const typed = new Set(config.types)
  const dirs = [...new Set([config.docs, ...(typed.has('decisions') ? [config.decisions.folder] : [])])]
  const files = [...new Set((await Promise.all(dirs.map(dir => listFiles(root, dir)))).flat())].sort()

  for (const file of files.filter(name => name.endsWith('.md'))) {
    const text = (await readText(root, file)) ?? ''
    texts.push({ file, text })
    const decision = typed.has('decisions') && under(file, config.decisions.folder)
    const split = splitFrontMatter(text) ?? (decision ? undefined : { yaml: '{}', body: text, bodyLine: 1 })
    if (!split) {
      findings.push(error('frontmatter', file, 1, 'Front matter is missing'))
      continue
    }
    const yaml = parseYaml(split.yaml, file, 2)
    const markdown = parseMarkdown(split.body, file, split.bodyLine)
    findings.push(...markdown.findings)
    if (isFinding(yaml)) {
      findings.push(yaml)
      continue
    }
    const base = { file, lineOf: yaml.lineOf, blocks: markdown.blocks }
    if (decision) {
      const result = validate(decisionSchema(config.decisions['id-prefix']), yaml.value, file, yaml.lineOf)
      findings.push(...result.findings)
      if (result.value) decisions.push({ kind: 'decision', meta: result.value, ...base })
    } else {
      const result = validate(pageSchema, yaml.value, file, yaml.lineOf)
      findings.push(...result.findings)
      if (result.value)
        pages.push({ kind: 'page', ...titled(file, result.value, markdown.blocks), file, lineOf: yaml.lineOf })
    }
  }

  for (const catalog of catalogKinds.filter(kind => typed.has(kind))) {
    const file = config.catalogs[catalog]
    const text = await readText(root, file)
    if (text === undefined) continue
    texts.push({ file, text })
    const yaml = parseYaml(text, file)
    if (isFinding(yaml)) {
      findings.push(yaml)
      continue
    }
    const list = validate(z.array(z.unknown()).min(1), yaml.value, file, yaml.lineOf)
    findings.push(...list.findings)
    for (const [index, item] of (list.value ?? []).entries()) {
      const result = validate(catalogSchemas[catalog], item, file, yaml.lineOf, [index])
      findings.push(...result.findings)
      if (result.value)
        entries.push({
          catalog,
          file,
          value: result.value,
          line: yaml.lineOf([index]),
          lineOf: path => yaml.lineOf([index, ...path]),
        })
    }
  }

  return {
    sources: { pages, decisions, entries, diagrams: files.filter(name => name.endsWith('.drawio')), texts },
    findings,
  }
}
