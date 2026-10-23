import { parseDrawio } from '../diagrams/parse.ts'
import { prepare } from '../diagrams/prepare.ts'
import { error, type Finding } from '../findings.ts'
import type { Context, Rule } from './context.ts'

async function checkDiagram(context: Context, file: string): Promise<Finding[]> {
  let pages
  try {
    pages = parseDrawio((await context.read(file)) ?? '')
  } catch (cause) {
    return [error('diagrams/parse', file, 1, cause instanceof Error ? cause.message : String(cause))]
  }
  const [page] = pages
  if (!page || pages.length > 1) return [error('diagrams/pages', file, 1, 'A diagram file must have exactly one page')]
  const { xml, problems } = prepare(page, context.theme)
  const findings: Finding[] = problems.map(problem => ({ ...problem, file, line: 1 }))
  if (!context.render || findings.some(finding => finding.severity === 'error')) return findings
  try {
    await context.render(xml)
  } catch (cause) {
    findings.push(error('diagrams/render', file, 1, cause instanceof Error ? cause.message : String(cause)))
  }
  return findings
}

export const diagrams: Rule = async context =>
  (await Promise.all(context.sources.diagrams.map(file => checkDiagram(context, file)))).flat()
