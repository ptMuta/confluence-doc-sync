import { isNode, LineCounter, parseDocument } from 'yaml'
import type { z } from 'zod'
import { error, type Finding } from '../findings.ts'

export interface Yaml {
  readonly value: unknown
  readonly lineOf: (path: readonly PropertyKey[]) => number
}

export function parseYaml(text: string, file: string, firstLine = 1): Yaml | Finding {
  const counter = new LineCounter()
  const doc = parseDocument(text, { lineCounter: counter, prettyErrors: false, uniqueKeys: true, schema: 'core' })
  const lineAt = (offset: number) => counter.linePos(offset).line + firstLine - 1
  const [problem] = [...doc.errors, ...doc.warnings]
  if (problem) return error('yaml', file, lineAt(problem.pos[0]), problem.message)
  let value: unknown
  try {
    value = doc.toJS({ maxAliasCount: 0 })
  } catch {
    return error('yaml', file, firstLine, 'YAML aliases are not allowed')
  }
  const lineOf = (path: readonly PropertyKey[]) => {
    for (let n = path.length; n > 0; n--) {
      const node = doc.getIn(path.slice(0, n), true)
      if (isNode(node) && node.range) return lineAt(node.range[0])
    }
    return firstLine
  }
  return { value, lineOf }
}

export const isFinding = (value: Yaml | Finding): value is Finding => 'rule' in value

export function validate<S extends z.ZodType>(
  schema: S,
  value: unknown,
  file: string,
  lineOf: (path: readonly PropertyKey[]) => number,
  base: readonly PropertyKey[] = [],
): { value: z.output<S> | undefined; findings: Finding[] } {
  const result = schema.safeParse(value)
  if (result.success) return { value: result.data, findings: [] }
  return {
    value: undefined,
    findings: result.error.issues.map(issue => {
      const path = [...base, ...issue.path, ...(issue.code === 'unrecognized_keys' ? issue.keys.slice(0, 1) : [])]
      const where = path.map(String).join('.')
      return error('schema', file, lineOf(path), where ? `${where}: ${issue.message}` : issue.message)
    }),
  }
}
