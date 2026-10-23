import { error, type Finding } from '../findings.ts'
import { inlines, spans } from '../model/text.ts'
import type { Sources } from '../source/load.ts'
import { externalRefFields, localRefFields } from '../source/schemas.ts'
import { documents, type Rule } from './context.ts'
import { owners } from './ids.ts'

interface Use {
  readonly ref: string
  readonly file: string
  readonly line: number
}

const listed = (value: unknown): string[] => (Array.isArray(value) ? value.filter(v => typeof v === 'string') : [])

export function uses(sources: Sources): Use[] {
  const uses: Use[] = []
  for (const decision of sources.decisions) {
    const { meta, file, lineOf } = decision
    for (const key of ['supersedes', 'superseded-by'] as const) {
      const ref = meta[key]
      if (ref) uses.push({ ref, file, line: lineOf([key]) })
    }
    for (const key of externalRefFields)
      for (const [index, ref] of (meta[key] ?? []).entries()) uses.push({ ref, file, line: lineOf([key, index]) })
    for (const [index, deviation] of (meta['deviates-from'] ?? []).entries())
      uses.push({ ref: deviation.ref, file, line: lineOf(['deviates-from', index, 'ref']) })
  }
  for (const entry of sources.entries)
    for (const key of [...localRefFields, ...externalRefFields])
      for (const [index, ref] of listed(entry.value[key]).entries())
        uses.push({ ref, file: entry.file, line: entry.lineOf([key, index]) })
  for (const document of documents(sources))
    for (const span of spans(document.blocks))
      for (const node of inlines(span.inlines))
        if (node.type === 'ref') uses.push({ ref: node.id, file: document.file, line: span.line })
  return uses
}

export const refs: Rule = ({ config, sources }) => {
  const known = new Set(owners(sources).map(owner => owner.id))
  const findings: Finding[] = []
  for (const { ref, file, line } of uses(sources)) {
    const colon = ref.indexOf(':')
    if (colon < 0) {
      if (!known.has(ref)) findings.push(error('refs/unknown-id', file, line, `${ref} does not exist`))
      continue
    }
    const prefix = ref.slice(0, colon)
    const source = config['reference-sources'][prefix]
    if (!source)
      findings.push(error('refs/unknown-source', file, line, `Reference source "${prefix}" is not configured`))
    else if (!new RegExp(`^(?:${source['id-pattern']})$`, 'u').test(ref.slice(colon + 1)))
      findings.push(error('refs/bad-id', file, line, `${ref} does not match the id pattern of "${prefix}"`))
  }
  return findings
}
