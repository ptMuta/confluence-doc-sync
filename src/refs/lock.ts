import { z } from 'zod'
import { error, warning, type Finding } from '../findings.ts'
import type { Resolved, Use } from './resolve.ts'

const lockSchema = z.strictObject({
  version: z.literal(1),
  refs: z.record(z.string(), z.strictObject({ page: z.string().regex(/^\d+$/), state: z.string().optional() })),
})

export type Lock = z.output<typeof lockSchema>

export function parseLock(text: string | undefined, file: string): { lock: Lock; findings: Finding[] } {
  const empty: Lock = { version: 1, refs: {} }
  if (text === undefined) return { lock: empty, findings: [] }
  try {
    return { lock: lockSchema.parse(JSON.parse(text)), findings: [] }
  } catch {
    return { lock: empty, findings: [error('refs/lock', file, 1, `${file} is not a valid lock file`)] }
  }
}

export const formatLock = (lock: Lock): string => `${JSON.stringify(lock, null, 2)}\n`

export function compareLock(
  lock: Lock,
  resolved: ReadonlyMap<string, Resolved>,
  uses: readonly Use[],
  file: string,
): { next: Lock; findings: Finding[] } {
  const findings: Finding[] = []
  const refs: Lock['refs'] = {}
  for (const [ref, target] of [...resolved].sort(([a], [b]) => a.localeCompare(b))) {
    const use = uses.find(item => item.ref === ref)
    const at = (rule: string, message: string, fail = false) =>
      findings.push((fail ? error : warning)(rule, use?.file ?? file, use?.line ?? 1, message))
    const locked = lock.refs[ref]
    if (!locked) at('refs/lock', `${ref} is not in ${file} yet; commit the lock file from the plan bundle`)
    else if (locked.page !== target.page)
      at('refs/lock', `${ref} now points at page ${target.page}, but ${file} pins page ${locked.page}`, true)
    else if (locked.state !== target.state)
      at('refs/lock', `${ref} changed from ${locked.state ?? 'no state'} to ${target.state ?? 'no state'}`)
    refs[ref] = { page: target.page, ...(target.state ? { state: target.state } : {}) }
  }
  for (const ref of Object.keys(lock.refs))
    if (!resolved.has(ref) && !uses.some(use => use.ref === ref))
      findings.push(
        warning('refs/lock', file, 1, `${ref} is no longer used; commit the lock file from the plan bundle`),
      )
  return { next: { version: 1, refs }, findings }
}
