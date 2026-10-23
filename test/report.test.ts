import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Finding } from '../src/findings.ts'

const summary = vi.hoisted(() => {
  const chain = { addHeading: vi.fn(), addRaw: vi.fn(), addTable: vi.fn(), write: vi.fn() }
  for (const fn of [chain.addHeading, chain.addRaw, chain.addTable]) fn.mockReturnValue(chain)
  return chain
})
const core = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('@actions/core', () => ({ ...core, summary }))

const { report } = await import('../src/report.ts')

const findings: Finding[] = [
  { rule: 'b', severity: 'error', file: 'a.md', line: 2, message: 'Bad' },
  { rule: 'a', severity: 'warning', file: 'a.md', line: 3, message: 'Meh' },
  { rule: 'a', severity: 'warning', file: 'b.md', line: 1, message: 'Meh' },
]

describe('report', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('annotates findings, writes the summary and fails on errors', async () => {
    vi.stubEnv('GITHUB_STEP_SUMMARY', '/tmp/summary')
    await expect(report(findings)).rejects.toThrow('Docs check found 1 errors')
    expect(core.error).toHaveBeenCalledWith('Bad', { title: 'b', file: 'a.md', startLine: 2 })
    expect(core.warning).toHaveBeenCalledTimes(2)
    expect(summary.addRaw).toHaveBeenCalledWith('1 errors, 2 warnings', true)
    expect(summary.addTable).toHaveBeenCalledWith([
      [
        { data: 'Rule', header: true },
        { data: 'Count', header: true },
      ],
      ['a', '2'],
      ['b', '1'],
    ])
  })

  it('passes with warnings and skips the summary outside Actions', async () => {
    vi.stubEnv('GITHUB_STEP_SUMMARY', '')
    await report(findings.slice(1))
    expect(summary.write).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith('Docs check passed with 2 warnings')
  })
})
