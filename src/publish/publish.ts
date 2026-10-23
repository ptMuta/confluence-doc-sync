import { analyze } from '../check.ts'
import type { Config } from '../config/schema.ts'
import { cloudId, writeClient, type WriteHttp } from '../confluence/http/client.ts'
import { cloudReader } from '../confluence/reader.ts'
import { cloudWriter, missingWriteScopes } from '../confluence/writer.ts'
import { error, type Finding } from '../findings.ts'
import { contentHash } from '../plan/desired.ts'
import { classify, type Classified, type Op } from '../plan/diff.ts'
import { canonical } from '../plan/hash.ts'
import { preflight } from '../plan/plan.ts'
import { currentState, type Owned } from '../plan/state.ts'
import { checkVisibility } from '../plan/visibility.ts'
import { apply } from './apply.ts'
import { readBundle, type Bundle } from './bundle.ts'
import { validSignature } from './marker.ts'

const tiers = ['unreviewed', 'reviewed', 'approver'] as const
type Tier = (typeof tiers)[number]

export interface PublishOptions {
  readonly root: string
  readonly configFile: string
  readonly token: string
  readonly bundlePath: string
  readonly expectedSha256: string
  readonly tier: string
  readonly ownershipKey: string
  readonly author?: string | undefined
  readonly env: Readonly<Record<string, string | undefined>>
  readonly connect?: ((site: string, token: string) => Promise<{ http: WriteHttp; cloudId: string }>) | undefined
  readonly pause?: ((seconds: number) => Promise<unknown>) | undefined
}

export interface PublishResult {
  readonly findings: Finding[]
  readonly applied?: Readonly<Record<Op['kind'], number>>
}

const hasErrors = (findings: readonly Finding[]) => findings.some(finding => finding.severity === 'error')
const isTier = (value: string): value is Tier => (tiers as readonly string[]).includes(value)

function gate(
  tier: Tier,
  config: Config,
  ops: readonly Classified[],
  actor: string | undefined,
  author: string | undefined,
): string | undefined {
  if (tier === 'reviewed') return undefined
  if (tier === 'approver') {
    const login = actor?.toLowerCase()
    if (!login || !config.approvers.some(name => name.toLowerCase() === login))
      return `${actor ?? 'The user who started this run'} is not in approvers`
    if (config['self-approval']) return undefined
    if (!author) return 'change-author is needed when self-approval is false'
    return author.toLowerCase() === login ? `${actor ?? ''} cannot approve their own change` : undefined
  }
  if (!ops.length || config.approval === 'none') return undefined
  if (config.approval === 'always') return 'approval: always needs the reviewed or approver tier'
  const risky = [...new Set(ops.flatMap(item => (item.risky ? [item.risky] : [])))]
  return risky.length ? `Risky changes need the reviewed or approver tier: ${risky.join(', ')}` : undefined
}

function checkOps(bundle: Bundle, ops: readonly Classified[], owned: readonly Owned[], key: string, root: string) {
  const { plan, images } = bundle
  const problems: string[] = []
  const byKey = new Map(owned.map(page => [page.key, page]))
  const signed = (page: Owned) =>
    validSignature(
      key,
      { page: page.id, source: page.key, hash: page.hash, version: page.markerVersion },
      page.signature,
    )
  const pages = new Map(plan.pages.map(page => [page.key, page]))
  const created = new Set(ops.flatMap(({ op }) => (op.kind === 'create' ? [op.key] : [])))
  const writes = ops.flatMap(({ op }) => (op.kind === 'create' || op.kind === 'update' ? [op.key] : []))
  const named = ops.map(({ op }) => `${op.kind} ${op.key}`)
  if (new Set(named).size !== named.length || pages.size !== plan.pages.length)
    problems.push('The plan lists a change or a page twice')
  if (new Set(writes).size !== writes.length || writes.length !== pages.size || writes.some(item => !pages.has(item)))
    problems.push('The plan pages do not match its creates and updates')
  const parentOk = (parent: { page: string } | { key: string }) =>
    'key' in parent
      ? created.has(parent.key)
      : parent.page === root || owned.some(page => page.id === parent.page && signed(page))

  for (const { op } of ops) {
    const where = `${op.kind} ${op.key}`
    if (op.kind === 'create') {
      const other = byKey.get(op.key)
      if (other) problems.push(`${where}: page ${other.id} already holds this source`)
      if (!parentOk(op.parent)) problems.push(`${where}: the parent is not the root page or a page this tool owns`)
    } else {
      const current = byKey.get(op.key)
      if (current?.id !== op.page) {
        problems.push(`${where}: page ${op.page} does not hold this source under the root page`)
        continue
      }
      if (!signed(current)) {
        problems.push(`${where}: page ${op.page} has no valid ownership signature`)
        continue
      }
      const overwrites = ops.some(
        item => item.op.kind === 'update' && item.op.key === op.key && item.op.changes.includes('manual-edit'),
      )
      if (current.edited && op.kind !== 'archive' && !overwrites)
        problems.push(`${where}: page ${op.page} was edited in Confluence after the plan; plan again`)
      if (op.kind === 'move' && !parentOk(op.to))
        problems.push(`${where}: the new parent is not the root page or a page this tool owns`)
      if (op.kind === 'archive' && pages.has(op.key)) problems.push(`${where}: the plan also writes this page`)
    }
    if ((op.kind === 'create' || op.kind === 'update') && pages.get(op.key)?.title !== op.title)
      problems.push(`${where}: the title does not match the page`)
  }
  for (const page of plan.pages)
    if (contentHash(page, images) !== page.hash) problems.push(`Page ${page.key}: the content does not match its hash`)
  return problems
}

async function connectCloud(site: string, token: string, pin?: string) {
  const id = await cloudId(site)
  if (pin && pin !== id) throw new Error(`${site} has cloud id ${id}, but the config pins ${pin}`)
  return { http: writeClient(id, token), cloudId: id }
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

export async function publish(options: PublishOptions): Promise<PublishResult> {
  const { root, configFile, env, tier } = options
  const findings: Finding[] = []
  const fail = (rule: string, text: string) => {
    findings.push(error(rule, configFile, 1, text))
    return { findings }
  }
  if (!isTier(tier)) return fail('publish/tier', `environment-tier must be one of: ${tiers.join(', ')}`)
  if (options.ownershipKey.length < 32) return fail('publish/key', 'ownership-key must be at least 32 characters')

  const analysis = await analyze(root, configFile, undefined)
  const { config, sources } = analysis
  if (!config || !sources || hasErrors(analysis.findings)) return { findings: analysis.findings }
  const { site, space: spaceKey, 'root-page': rootPage } = config.confluence

  let bundle: Bundle
  try {
    bundle = await readBundle(options.bundlePath, options.expectedSha256)
  } catch (cause) {
    return fail('publish/bundle', message(cause))
  }
  const { plan } = bundle
  const { GITHUB_SHA: commit, GITHUB_REF: ref, GITHUB_ACTOR: actor } = env
  if (!commit || plan.commit !== commit)
    return fail(
      'publish/commit',
      `The plan is for ${plan.commit ?? 'no commit'}, not ${commit ?? 'this run'}; plan again`,
    )
  if (ref !== `refs/heads/${config.branch}`)
    return fail('publish/branch', `Publish runs only on ${config.branch}, not ${ref ?? 'an unknown ref'}`)
  const differs = [
    ['site', plan.site, site],
    ['space', plan.space.key, spaceKey],
    ['root-page', plan.root, rootPage],
    ['approval', plan.approval, config.approval],
  ].flatMap(([name, planned, configured]) => (planned === configured ? [] : [name]))
  if (differs.length) return fail('publish/config', `The plan does not match the config: ${differs.join(', ')}`)

  const deviating = new Set(sources.decisions.filter(d => d.meta['deviates-from']).map(d => d.file))
  const ops = classify(
    plan.ops.map(item => item.op),
    deviating,
  )
  const refusal = gate(tier, config, ops, actor, options.author)
  if (refusal) return fail('publish/approval', refusal)

  const connection = options.connect
    ? await options.connect(site, options.token)
    : await connectCloud(site, options.token, config.confluence['cloud-id'])
  if (connection.cloudId !== plan.cloudId) return fail('publish/site', 'The site cloud id changed since the plan')
  const { http } = connection
  const reader = cloudReader(http)
  const missing = [
    ...(await preflight(
      http,
      reader,
      [
        `/api/v2/spaces?keys=${spaceKey}`,
        `/api/v2/pages/${rootPage}`,
        `/api/v2/pages/${rootPage}/permissions?limit=1`,
        `/api/v2/pages/${rootPage}/descendants?limit=1&depth=1`,
        `/api/v2/pages/${rootPage}/attachments?limit=1`,
        ...(config.confluence.readers ? ['/rest/api/group/by-id?id=0'] : []),
      ],
      spaceKey,
    )),
    ...(await missingWriteScopes(http)),
  ]
  if (missing.length) return fail('publish/scopes', `The token is missing these scopes: ${missing.join(', ')}`)

  const space = await reader.space(spaceKey)
  if (space?.id !== plan.space.id) return fail('publish/space', `Space ${spaceKey} is not the space in the plan`)
  const visibility = await checkVisibility(reader, config, space, configFile)
  findings.push(...visibility.findings)
  if (hasErrors(findings)) return { findings }
  if (canonical(visibility.visibility) !== canonical(plan.visibility))
    return fail('publish/visibility', 'Who can view the root page changed since the plan; plan again')

  const state = await currentState(reader, rootPage, configFile)
  findings.push(...state.findings)
  if (hasErrors(findings)) return { findings }
  const problems = checkOps(bundle, ops, state.owned, options.ownershipKey, rootPage)
  if (problems.length) {
    findings.push(...problems.map(problem => error('publish/op', configFile, 1, problem)))
    return { findings }
  }

  await apply({
    reader,
    writer: cloudWriter(http, options.pause),
    bundle,
    ops,
    owned: state.owned,
    key: options.ownershipKey,
    site,
    space,
  })
  const count = (kind: Op['kind']) => ops.filter(({ op }) => op.kind === kind).length
  return {
    findings,
    applied: { create: count('create'), update: count('update'), move: count('move'), archive: count('archive') },
  }
}
