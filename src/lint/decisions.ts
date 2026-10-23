import { error, warning, type Finding } from '../findings.ts'
import { inlineText } from '../model/text.ts'
import type { Block } from '../model/types.ts'
import type { Decision } from '../source/load.ts'
import type { Rule } from './context.ts'

const required = ['Context', 'Options', 'Decision', 'Consequences']
const optional = ['Drivers', 'Confirmation', 'Pros and cons', 'Links']

interface Section {
  readonly title: string
  readonly line: number
  readonly blocks: Block[]
}

function sections(blocks: readonly Block[]): { preamble: Block[]; sections: Section[] } {
  const preamble: Block[] = []
  const found: Section[] = []
  for (const block of blocks) {
    if (block.type === 'heading' && block.level === 2)
      found.push({ title: inlineText(block.children).trim(), line: block.line, blocks: [] })
    else (found.at(-1)?.blocks ?? preamble).push(block)
  }
  return { preamble, sections: found }
}

const items = (section: Section | undefined) =>
  section?.blocks.flatMap(block => (block.type === 'list' ? block.items : [])) ?? []

const onlyRefs = (item: readonly Block[], links: boolean) =>
  item.every(
    block =>
      block.type === 'paragraph' &&
      block.children.length > 0 &&
      block.children.every(
        node => node.type === 'ref' || (links && node.type === 'link') || (node.type === 'text' && !node.value.trim()),
      ),
  )

function checkDecision(decision: Decision, all: ReadonlyMap<string, Decision>): Finding[] {
  const { file, meta, lineOf } = decision
  const findings: Finding[] = []
  const { preamble, sections: found } = sections(decision.blocks)
  const first = preamble[0]
  if (first) findings.push(error('decision/sections', file, first.line, 'Content must sit under a section heading'))
  const byTitle = new Map<string, Section>()
  for (const section of found) {
    if (![...required, ...optional].includes(section.title))
      findings.push(
        error(
          'decision/sections',
          file,
          section.line,
          `Unknown section "${section.title}"; use ${[...required, ...optional].join(', ')}`,
        ),
      )
    else if (byTitle.has(section.title))
      findings.push(error('decision/sections', file, section.line, `Section "${section.title}" appears twice`))
    else byTitle.set(section.title, section)
  }
  for (const title of required)
    if (!byTitle.has(title)) findings.push(error('decision/sections', file, 1, `Section "${title}" is missing`))

  const options = byTitle.get('Options')
  const minimum = meta['constrained-by'] ? 1 : 2
  if (options && items(options).length < minimum)
    findings.push(
      error(
        'decision/options',
        file,
        options.line,
        minimum === 2 ? 'List at least 2 real options, or set constrained-by' : 'List at least 1 option',
      ),
    )

  for (const [title, links] of [
    ['Drivers', false],
    ['Links', true],
  ] as const) {
    const section = byTitle.get(title)
    if (section && !items(section).every(item => onlyRefs(item, links)))
      findings.push(
        error(
          'decision/ids-only',
          file,
          section.line,
          `${title} must list ${links ? 'ids or links' : 'ids'} such as [[FR-001]], not free text`,
        ),
      )
  }

  const statement = byTitle.get('Decision')?.blocks.find(block => block.type === 'paragraph')
  if (statement) {
    const sentence = inlineText(statement.children).split(/(?<=[.!?])\s/)[0] ?? ''
    if (!/\bbecause\b/i.test(sentence))
      findings.push(
        warning(
          'decision/statement',
          file,
          statement.line,
          'Start the decision with one sentence: "We use X because Y"',
        ),
      )
  }

  const replacement = meta['superseded-by']
  if (replacement && meta.retired)
    findings.push(error('decision/supersede', file, lineOf(['retired']), 'A decision is either superseded or retired'))
  if (replacement && all.get(replacement) && all.get(replacement)?.meta.supersedes !== meta.id)
    findings.push(
      error('decision/supersede', file, lineOf(['superseded-by']), `${replacement} must set supersedes: ${meta.id}`),
    )
  const replaced = meta.supersedes
  if (replaced && all.get(replaced) && all.get(replaced)?.meta['superseded-by'] !== meta.id)
    findings.push(
      error('decision/supersede', file, lineOf(['supersedes']), `${replaced} must set superseded-by: ${meta.id}`),
    )
  return findings
}

export const decisions: Rule = ({ sources }) => {
  const all = new Map(sources.decisions.map(decision => [decision.meta.id, decision]))
  return sources.decisions.flatMap(decision => checkDecision(decision, all))
}
