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
}))
vi.mock('@actions/core', () => core)

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
    vi.spyOn(process, 'cwd').mockReturnValue(join(import.meta.dirname, 'fixtures', name))
    inputs['mode'] = 'check'
    await run()
    if (failure) expect(core.setFailed).toHaveBeenCalledWith(failure)
    else expect(core.setFailed).not.toHaveBeenCalled()
  })

  it.each(['plan', 'publish'])('fails %s until it exists', async mode => {
    inputs['mode'] = mode
    await run()
    expect(core.setFailed).toHaveBeenCalledWith(`Mode "${mode}" is not implemented yet`)
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
