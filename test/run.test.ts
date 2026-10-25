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
const publisher = vi.hoisted(() => ({ publish: vi.fn() }))
vi.mock('../src/publish/publish.ts', () => publisher)

const { run } = await import('../src/run.ts')
const summary = join(await mkdtemp(join(tmpdir(), 'summary-')), 'summary.md')

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

  it('needs every publish input', async () => {
    inputs['mode'] = 'publish'
    inputs['confluence-token'] = 'token'
    await run()
    expect(core.setFailed).toHaveBeenCalledWith('Mode "publish" needs expected-bundle-sha256')
  })

  it('needs a token to plan', async () => {
    inputs['mode'] = 'plan'
    await run()
    expect(core.setFailed).toHaveBeenCalledWith('Mode "plan" needs confluence-token')
  })

  it('sets the plan outputs and writes a summary', async () => {
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

  it('publishes and summarizes what changed', async () => {
    await writeFile(summary, '')
    vi.stubEnv('GITHUB_STEP_SUMMARY', summary)
    Object.assign(inputs, {
      mode: 'publish',
      'confluence-token': 'token',
      'expected-bundle-sha256': 'abc',
      'environment-tier': 'high-risk',
      'ownership-key': 'key',
      'change-author': 'someone',
    })
    publisher.publish.mockResolvedValue({ findings: [], applied: { create: 2, update: 1, move: 0, archive: 0 } })
    await run()
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ bundlePath: 'docs-sync-plan', tier: 'high-risk', author: 'someone' }),
    )
    expect(core.info).toHaveBeenCalledWith('Published: 2 created, 1 updated, 0 moved, 0 archived')
    expect(await readFile(summary, 'utf8')).toContain('Archived')
    vi.stubEnv('GITHUB_STEP_SUMMARY', '')
    publisher.publish.mockResolvedValue({ findings: [] })
    await run()
    expect(core.setFailed).not.toHaveBeenCalled()
  })
})
