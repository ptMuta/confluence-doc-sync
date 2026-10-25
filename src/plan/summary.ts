import * as core from '@actions/core'
import type { PublishResult } from '../publish/publish.ts'
import type { PlanResult } from './plan.ts'

type Outcome = NonNullable<PlanResult['outcome']>

export async function summarize(bundlePath: string, outcome: Outcome): Promise<void> {
  const { sha256, risk, ops, lockChanged } = outcome
  core.setOutput('bundle-path', bundlePath)
  core.setOutput('bundle-sha256', sha256)
  core.setOutput('has-changes', String(ops.length > 0))
  core.setOutput('risk', risk)
  const count = (kind: string) => String(ops.filter(({ op }) => op.kind === kind).length)
  const risky = String(ops.filter(item => item.risky).length)
  core.info(`Plan ${sha256}: ${String(ops.length)} changes, risk ${risk}`)
  if (!process.env['GITHUB_STEP_SUMMARY']) return
  await core.summary
    .addTable([
      ['Create', 'Update', 'Move', 'Reorder', 'Archive', 'Risky', 'Risk'].map(data => ({ data, header: true })),
      [count('create'), count('update'), count('move'), count('order'), count('archive'), risky, risk],
    ])
    .addRaw(`Bundle SHA-256: \`${sha256}\``, true)
    .addRaw(lockChanged ? '\n\nThe lock file changed: commit docs-sync.lock from the plan bundle.' : '', true)
    .write()
}

export async function published(applied: NonNullable<PublishResult['applied']>): Promise<void> {
  const { create, update, move, order, archive } = applied
  core.info(
    `Published: ${String(create)} created, ${String(update)} updated, ${String(move)} moved, ${String(order)} reordered, ${String(archive)} archived`,
  )
  if (!process.env['GITHUB_STEP_SUMMARY']) return
  await core.summary
    .addTable([
      ['Created', 'Updated', 'Moved', 'Reordered', 'Archived'].map(data => ({ data, header: true })),
      [create, update, move, order, archive].map(String),
    ])
    .write()
}
