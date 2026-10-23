import { basename } from 'node:path'
import { error, type Finding } from '../findings.ts'
import type { Sources } from '../source/load.ts'
import type { Rule } from './context.ts'

interface Owner {
  readonly id: string
  readonly file: string
  readonly line: number
}

export const owners = (sources: Sources): Owner[] => [
  ...sources.decisions.map(d => ({ id: d.meta.id, file: d.file, line: d.lineOf(['id']) })),
  ...sources.entries.map(e => ({ id: e.value.id, file: e.file, line: e.lineOf(['id']) })),
]

export const ids: Rule = ({ sources }) => {
  const findings: Finding[] = []
  const seen = new Map<string, Owner>()
  for (const owner of owners(sources)) {
    const first = seen.get(owner.id)
    if (first)
      findings.push(error('ids/duplicate', owner.file, owner.line, `${owner.id} is also used in ${first.file}`))
    else seen.set(owner.id, owner)
  }
  for (const decision of sources.decisions) {
    const name = basename(decision.file)
    if (name !== `${decision.meta.id}.md` && !name.startsWith(`${decision.meta.id}-`))
      findings.push(
        error('ids/filename', decision.file, decision.lineOf(['id']), `File name must start with ${decision.meta.id}`),
      )
  }
  return findings
}
