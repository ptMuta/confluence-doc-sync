import { error, warning, type Finding } from '../findings.ts'
import { inlineText, spans, words } from '../model/text.ts'
import type { Block } from '../model/types.ts'
import { documents, type Rule } from './context.ts'

const placeholders = new Set([
  'n/a',
  'na',
  'tbd',
  'tba',
  'todo',
  'none',
  'to be decided',
  'to be determined',
  'to be defined',
])

const filler = [
  'it is important to note',
  'it should be noted',
  'in order to',
  'robust',
  'seamless',
  'seamlessly',
  'leverage',
  'leverages',
  'cutting-edge',
  'state-of-the-art',
]

function* strings(value: unknown, path: readonly PropertyKey[] = []): Generator<{ text: string; path: PropertyKey[] }> {
  if (typeof value === 'string') yield { text: value, path: [...path] }
  else if (Array.isArray(value)) for (const [index, item] of value.entries()) yield* strings(item, [...path, index])
  else if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) yield* strings(item, [...path, key])
}

function emptySections(blocks: readonly Block[], file: string): Finding[] {
  const findings: Finding[] = []
  for (const [index, block] of blocks.entries()) {
    if (block.type !== 'heading') continue
    const next = blocks[index + 1]
    if (block.level === 1)
      findings.push(
        error('markdown/heading', file, block.line, 'Use the front matter title instead of a level 1 heading'),
      )
    if (!inlineText(block.children).trim())
      findings.push(error('content/empty-section', file, block.line, 'Empty heading'))
    else if (!next || (next.type === 'heading' && next.level <= block.level))
      findings.push(error('content/empty-section', file, block.line, 'Section has no content; remove it'))
  }
  return findings
}

export const content: Rule = ({ config, sources }) => {
  const findings: Finding[] = []
  const phrases = [...filler, ...config.lint.filler].map(phrase => ({ phrase, words: ` ${words(phrase).join(' ')} ` }))
  const prose = (text: string, file: string, line: number) => {
    const trimmed = text.trim()
    if (placeholders.has((trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed).toLowerCase()))
      findings.push(error('content/placeholder', file, line, `Placeholder "${trimmed}"; remove the field or section`))
    const joined = ` ${words(text).join(' ')} `
    for (const phrase of phrases)
      if (joined.includes(phrase.words))
        findings.push(warning('content/filler', file, line, `Filler phrase "${phrase.phrase}"`))
  }
  const { budgets } = config.lint

  for (const document of documents(sources)) {
    findings.push(...emptySections(document.blocks, document.file))
    for (const { text, path } of strings(document.meta)) prose(text, document.file, document.lineOf(path))
    let count = 0
    for (const span of spans(document.blocks)) {
      const text = inlineText(span.inlines)
      prose(text, document.file, span.line)
      count += words(text).length
    }
    if (document.kind === 'decision' && count > budgets.decision)
      findings.push(
        warning(
          'content/length',
          document.file,
          1,
          `${String(count)} words; the budget is ${String(budgets.decision)}`,
        ),
      )
    const summary = document.blocks.find(block => block.type === 'paragraph')
    const size = summary ? words(inlineText(summary.children)).length : 0
    if (document.kind === 'page' && summary && size > budgets.summary)
      findings.push(
        warning(
          'content/length',
          document.file,
          summary.line,
          `Opening paragraph has ${String(size)} words; the budget is ${String(budgets.summary)}`,
        ),
      )
  }

  for (const entry of sources.entries) {
    let count = 0
    for (const { text, path } of strings(entry.value)) {
      prose(text, entry.file, entry.lineOf(path))
      count += words(text).length
    }
    if (count > budgets['catalog-entry'])
      findings.push(
        warning(
          'content/length',
          entry.file,
          entry.line,
          `${entry.value.id} has ${String(count)} words; the budget is ${String(budgets['catalog-entry'])}`,
        ),
      )
  }
  return findings
}

const shingles = (text: string) => {
  const list = words(text)
  return new Set(
    list.slice(0, -2).map((word, index) => `${word} ${String(list[index + 1])} ${String(list[index + 2])}`),
  )
}

export const duplicates: Rule = ({ sources }) => {
  const seen: { file: string; line: number; set: Set<string> }[] = []
  const findings: Finding[] = []
  for (const document of documents(sources))
    for (const span of spans(document.blocks)) {
      const text = inlineText(span.inlines)
      if (words(text).length < 12) continue
      const set = shingles(text)
      const match = seen.find(other => {
        if (other.file === document.file) return false
        const shared = [...set].filter(item => other.set.has(item)).length
        return shared / (set.size + other.set.size - shared) >= 0.8
      })
      if (match)
        findings.push(
          warning(
            'content/duplicate',
            document.file,
            span.line,
            `Nearly the same text as ${match.file}:${String(match.line)}; link to it instead`,
          ),
        )
      seen.push({ file: document.file, line: span.line, set })
    }
  return findings
}

const secretPatterns: readonly [string, RegExp][] = [
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['GitHub token', /\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Atlassian token', /\bATATT[A-Za-z0-9_\-=]{20,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe key', /\b[rs]k_live_[0-9a-zA-Z]{20,}/],
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
]

export const secrets: Rule = ({ config, sources }) => {
  const patterns: [string, RegExp][] = [
    ...secretPatterns,
    ...config.lint['deny-patterns'].map((source, index): [string, RegExp] => [
      `deny pattern ${String(index + 1)}`,
      new RegExp(source, 'u'),
    ]),
  ]
  const findings: Finding[] = []
  for (const { file, text } of sources.texts)
    for (const [index, line] of text.split('\n').entries())
      for (const [name, pattern] of patterns)
        if (pattern.test(line)) findings.push(error('content/secret', file, index + 1, `Possible ${name}; remove it`))
  return findings
}
