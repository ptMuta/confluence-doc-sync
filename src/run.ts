import * as core from '@actions/core'
import { check } from './check.ts'
import { findRenderer } from './diagrams/render/drawio.ts'
import { parseInputs, type Inputs, type Mode } from './inputs.ts'
import { plan } from './plan/plan.ts'
import { publish } from './publish/publish.ts'
import { published, summarize } from './plan/summary.ts'
import { report } from './report.ts'

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
  publish: async inputs => {
    const need = (name: 'confluence-token' | 'expected-bundle-sha256' | 'environment-tier' | 'ownership-key') => {
      const value = inputs.values[name]
      if (!value) throw new Error(`Mode "publish" needs ${name}`)
      return value
    }
    const result = await publish({
      root: process.cwd(),
      configFile: inputs.config,
      token: need('confluence-token'),
      bundlePath: inputs.values['bundle-path'] ?? 'docs-sync-plan',
      expectedSha256: need('expected-bundle-sha256'),
      tier: need('environment-tier'),
      ownershipKey: need('ownership-key'),
      author: inputs.values['change-author'],
      env: process.env,
    })
    await report(result.findings, 'Docs publish')
    if (result.applied) await published(result.applied)
  },
}

export async function run(): Promise<void> {
  try {
    const inputs = parseInputs(name => core.getInput(name), core.setSecret)
    await handlers[inputs.mode](inputs)
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}
