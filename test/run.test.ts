import { beforeEach, describe, expect, it, vi } from 'vitest'

const inputs: Record<string, string> = {}
const core = vi.hoisted(() => ({
  getInput: vi.fn(),
  setSecret: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
}))
vi.mock('@actions/core', () => core)

const { run } = await import('../src/run.ts')

describe('run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(inputs)) Reflect.deleteProperty(inputs, key)
    core.getInput.mockImplementation((name: string) => inputs[name] ?? '')
  })

  it('runs check', async () => {
    inputs['mode'] = 'check'
    await run()
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledOnce()
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
