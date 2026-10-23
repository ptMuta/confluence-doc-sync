import * as core from '@actions/core'
import { check } from './check.ts'
import { findRenderer } from './diagrams/render/drawio.ts'
import { parseInputs, type Inputs, type Mode } from './inputs.ts'
import { plan } from './plan/plan.ts'
import { summarize } from './plan/summary.ts'
import { report } from './report.ts'

const notYet = (mode: Mode) => () => Promise.reject(new Error(`Mode "${mode}" is not implemented yet`))

const handlers: Record<Mode, (inputs: Inputs) => Promise<void>> = {
  check: async inputs => {
    const render = await findRenderer()
    if (!render) core.info('draw.io is not installed, so diagrams are checked but not rendered')
    await report(await check(process.cwd(), inputs.config, render))
  },
  plan: async inputs => {
    const token = inputs.values['confluence-token']
    if (!token) throw new Error('Mode "plan" needs confluence-token')
    const bundlePath = inputs.values['bundle-path'] ?? 'docs-sync-plan'
    const result = await plan({
      root: process.cwd(),
      configFile: inputs.config,
      token,
      bundlePath,
      render: await findRenderer(),
      env: process.env,
    })
    await report(result.findings, 'Docs plan')
    if (result.outcome) await summarize(bundlePath, result.outcome)
  },
  publish: notYet('publish'),
}

export async function run(): Promise<void> {
  try {
    const inputs = parseInputs(name => core.getInput(name), core.setSecret)
    await handlers[inputs.mode](inputs)
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}
