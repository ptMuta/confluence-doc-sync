import * as core from '@actions/core'
import type { Finding } from './findings.ts'

export async function report(findings: readonly Finding[], name = 'Docs check'): Promise<void> {
  for (const finding of findings) {
    const annotate = finding.severity === 'error' ? core.error : core.warning
    annotate(finding.message, { title: finding.rule, file: finding.file, startLine: finding.line })
  }
  const errors = findings.filter(finding => finding.severity === 'error').length
  const warnings = findings.length - errors
  const counts = new Map<string, number>()
  for (const finding of findings) counts.set(finding.rule, (counts.get(finding.rule) ?? 0) + 1)
  if (process.env['GITHUB_STEP_SUMMARY'])
    await core.summary
      .addHeading(name, 2)
      .addRaw(`${String(errors)} errors, ${String(warnings)} warnings`, true)
      .addTable([
        [
          { data: 'Rule', header: true },
          { data: 'Count', header: true },
        ],
        ...[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([rule, count]) => [rule, String(count)]),
      ])
      .write()
  if (errors) throw new Error(`${name} found ${String(errors)} errors`)
  core.info(`${name} passed with ${String(warnings)} warnings`)
}
