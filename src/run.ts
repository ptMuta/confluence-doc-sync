import * as core from '@actions/core'
import { parseInputs, type Mode } from './inputs.ts'

const notYet = (mode: Mode) => () => Promise.reject(new Error(`Mode "${mode}" is not implemented yet`))

const handlers: Record<Mode, () => Promise<void>> = {
  check: () => {
    core.info('No checks are implemented yet.')
    return Promise.resolve()
  },
  plan: notYet('plan'),
  publish: notYet('publish'),
}

export async function run(): Promise<void> {
  try {
    const inputs = parseInputs(name => core.getInput(name), core.setSecret)
    await handlers[inputs.mode]()
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}
