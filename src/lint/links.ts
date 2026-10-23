import { posix } from 'node:path'
import { error, type Finding } from '../findings.ts'
import { diagrams, inlines, spans } from '../model/text.ts'
import { linkFields } from '../source/schemas.ts'
import { documents, type Context, type Rule } from './context.ts'

const resolve = (from: string, href: string): string | undefined => {
  const path = posix.normalize(posix.join(posix.dirname(from), href.replace(/[?#].*$/, '')))
  return path.startsWith('../') || path === '..' || posix.isAbsolute(path) ? undefined : path
}

async function target(context: Context, from: string, href: string): Promise<string | undefined> {
  const path = resolve(from, href)
  if (path === undefined) return `${href} points outside the repository`
  return (await context.exists(path)) ? undefined : `${href} does not exist`
}

export const links: Rule = async context => {
  const findings: Finding[] = []
  for (const document of documents(context.sources)) {
    const { file, blocks } = document
    for (const span of spans(blocks)) {
      for (const node of inlines(span.inlines)) {
        if (
          node.type !== 'link' ||
          node.href.startsWith('https://') ||
          node.href.startsWith('#') ||
          /^[a-z][a-z0-9+.-]*:/i.test(node.href)
        )
          continue
        const problem = await target(context, file, node.href)
        if (problem) findings.push(error('markdown/link', file, span.line, problem))
      }
    }
    for (const diagram of diagrams(blocks)) {
      if (diagram.src.startsWith('https://') || /^[a-z][a-z0-9+.-]*:/i.test(diagram.src)) continue
      const problem = await target(context, file, diagram.src)
      if (problem) findings.push(error('markdown/diagram', file, diagram.line, problem))
    }
  }
  for (const entry of context.sources.entries)
    for (const field of linkFields[entry.catalog]) {
      const value = entry.value[field]
      if (typeof value !== 'string' || value.startsWith('https://')) continue
      const problem = /^[a-z][a-z0-9+.-]*:/i.test(value)
        ? `${value} must be an https link or a repository path`
        : await target(context, '', value)
      if (problem)
        findings.push(
          error(
            'catalog/link',
            entry.file,
            entry.lineOf([field]),
            `${field}: ${problem}; link a test, policy rule, alert or review`,
          ),
        )
    }
  return findings
}

export const usage: Rule = ({ sources, tags }) => {
  const findings: Finding[] = []
  const embedded = new Set(
    documents(sources).flatMap(document =>
      [...diagrams(document.blocks)].map(diagram => resolve(document.file, diagram.src)),
    ),
  )
  for (const file of sources.diagrams)
    if (!embedded.has(file)) findings.push(error('diagrams/unembedded', file, 1, 'No page embeds this diagram'))
  if (!tags) return findings
  const tagged = [
    ...documents(sources).map(document => ({ file: document.file, tags: document.meta.tags, lineOf: document.lineOf })),
    ...sources.entries.map(entry => ({ file: entry.file, tags: entry.value.tags, lineOf: entry.lineOf })),
  ]
  for (const { file, tags: list, lineOf } of tagged)
    for (const [index, tag] of (list ?? []).entries())
      if (!tags.has(tag))
        findings.push(error('tags/unknown', file, lineOf(['tags', index]), `Tag "${tag}" is not in the vocabulary`))
  return findings
}
