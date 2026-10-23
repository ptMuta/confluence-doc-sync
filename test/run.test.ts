import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const inputs: Record<string, string> = {}
const core = vi.hoisted(() => ({
  getInput: vi.fn(),
  setSecret: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  setOutput: vi.fn(),
}))
vi.mock('@actions/core', async importOriginal => ({ ...(await importOriginal<object>()), ...core }))
const planner = vi.hoisted(() => ({ plan: vi.fn() }))
vi.mock('../src/plan/plan.ts', () => planner)

const { run } = await import('../src/run.ts')

describe('run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(inputs)) Reflect.deleteProperty(inputs, key)
    core.getInput.mockImplementation((name: string) => inputs[name] ?? '')
  })

  it.each([
    ['good', undefined],
    ['bad', expect.stringMatching(/^Docs check found \d+ errors$/)],
  ])('runs check on the %s sample repo', async (name, failure) => {
    vi.stubEnv('GITHUB_STEP_SUMMARY', '')
    vi.spyOn(process, 'cwd').mockReturnValue(join(import.meta.dirname, 'fixtures', name))
    inputs['mode'] = 'check'
    await run()
    if (failure) expect(core.setFailed).toHaveBeenCalledWith(failure)
    else expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('fails publish until it exists', async () => {
    inputs['mode'] = 'publish'
    await run()
    expect(core.setFailed).toHaveBeenCalledWith('Mode "publish" is not implemented yet')
  })

  it('needs a token to plan', async () => {
    inputs['mode'] = 'plan'
    await run()
    expect(core.setFailed).toHaveBeenCalledWith('Mode "plan" needs confluence-token')
  })

  it('sets the plan outputs and writes a summary', async () => {
    const summary = join(await mkdtemp(join(tmpdir(), 'summary-')), 'summary.md')
    await writeFile(summary, '')
    vi.stubEnv('GITHUB_STEP_SUMMARY', summary)
    inputs['mode'] = 'plan'
    inputs['confluence-token'] = 'token'
    planner.plan.mockResolvedValue({
      findings: [],
      outcome: { sha256: 'abc', risk: 'high', ops: [{ op: { kind: 'create' }, risky: 'new page' }], lockChanged: true },
    })
    await run()
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.setOutput.mock.calls).toEqual([
      ['bundle-path', 'docs-sync-plan'],
      ['bundle-sha256', 'abc'],
      ['has-changes', 'true'],
      ['risk', 'high'],
    ])
    expect(await readFile(summary, 'utf8')).toContain('commit docs-sync.lock')
  })

  it('fails on refused inputs and masks secrets', async () => {
    inputs['mode'] = 'check'
    inputs['confluence-token'] = 'token'
    await run()
    expect(core.setSecret).toHaveBeenCalledWith('token')
    expect(core.setFailed).toHaveBeenCalledWith('Mode "check" does not accept: confluence-token')
  })

  it('reports non-Error throws', async () => {
    core.getInput.mockImplementation(() => {
      throw 'boom' as unknown as Error
    })
    await run()
    expect(core.setFailed).toHaveBeenCalledWith('boom')
  })
})
