import { posix } from 'node:path'
import { analyze } from '../check.ts'
import { cloudId, readClient, type Http } from '../confluence/http/client.ts'
import { missingScopes } from '../confluence/preflight.ts'
import { cloudReader, type Reader } from '../confluence/reader.ts'
import type { Renderer } from '../diagrams/render/drawio.ts'
import { error, type Finding } from '../findings.ts'
import { uses } from '../lint/refs.ts'
import { compareLock, formatLock, parseLock } from '../refs/lock.ts'
import { resolveRefs } from '../refs/resolve.ts'
import { readText } from '../source/files.ts'
import { writeBundle } from './bundle.ts'
import { desiredState } from './desired.ts'
import { classify, diff, overallRisk, titleClashes, type Classified, type Risk } from './diff.ts'
import { currentState } from './state.ts'
import { checkVisibility } from './visibility.ts'

export interface PlanOptions {
  readonly root: string
  readonly configFile: string
  readonly token: string
  readonly bundlePath: string
  readonly render?: Renderer | undefined
  readonly env: Readonly<Record<string, string | undefined>>
  readonly connect?: ((site: string, token: string) => Promise<Connection>) | undefined
}

export interface PlanResult {
  readonly findings: Finding[]
  readonly outcome?: {
    readonly sha256: string
    readonly risk: Risk
    readonly ops: readonly Classified[]
    readonly lockChanged: boolean
  }
}

const hasErrors = (findings: readonly Finding[]) => findings.some(finding => finding.severity === 'error')

interface Connection {
  readonly http: Http
  readonly cloudId: string
}

async function connectCloud(site: string, token: string, pin?: string): Promise<Connection> {
  const id = await cloudId(site)
  if (pin && pin !== id) throw new Error(`${site} has cloud id ${id}, but the config pins ${pin}`)
  return { http: readClient(id, token), cloudId: id }
}

export async function preflight(http: Http, reader: Reader, paths: string[], spaceKey: string): Promise<string[]> {
  const missing = await missingScopes(http, paths)
  if (missing.length) return missing
  const space = await reader.space(spaceKey)
  return space ? missingScopes(http, [`/api/v2/spaces/${space.id}/role-assignments?limit=1`]) : []
}

export async function plan(options: PlanOptions): Promise<PlanResult> {
  const { root, configFile, token, bundlePath, render, env } = options
  const analysis = await analyze(root, configFile, render)
  const { config, sources, theme } = analysis
  const findings = [...analysis.findings]
  const fail = (rule: string, message: string) => {
    findings.push(error(rule, configFile, 1, message))
    return { findings }
  }
  if (!config || !sources || !theme || hasErrors(findings)) return { findings }
  if (config['diagram-output'] === 'macro') return fail('plan/diagram-output', 'Macro output is not supported yet')
  if (sources.diagrams.length && !render) return fail('plan/render', 'draw.io is needed to render diagrams')
  const renderer: Renderer = render ?? (() => Promise.reject(new Error('no renderer')))

  const { site, space: spaceKey, 'root-page': rootPage, readers } = config.confluence
  const connection = options.connect
    ? await options.connect(site, token)
    : await connectCloud(site, token, config.confluence['cloud-id'])
  const { http } = connection
  const reader = cloudReader(http)
  const sourceSpaces = Object.values(config['reference-sources']).map(source => source.space)
  const missing = await preflight(
    http,
    reader,
    [
      `/api/v2/spaces?keys=${[spaceKey, ...sourceSpaces].join(',')}`,
      `/api/v2/pages/${rootPage}`,
      `/api/v2/pages/${rootPage}/permissions?limit=1`,
      `/api/v2/pages/${rootPage}/descendants?limit=1&depth=1`,
      ...(sourceSpaces.length ? ['/rest/api/content/search?cql=type%3Dfolder&limit=1', '/api/v2/folders/0'] : []),
      ...(readers ? ['/rest/api/group/by-id?id=0'] : []),
    ],
    spaceKey,
  )
  if (missing.length) return fail('plan/scopes', `The token is missing these scopes: ${missing.join(', ')}`)

  const space = await reader.space(spaceKey)
  if (!space) return fail('plan/space', `Space ${spaceKey} was not found or the token cannot see it`)
  if (!(await reader.item('page', rootPage))) return fail('plan/root', `Root page ${rootPage} was not found`)

  const visibility = await checkVisibility(reader, config, space, configFile)
  const refUses = uses(sources)
  const refs = await resolveRefs(reader, config, refUses, configFile)
  const lockFile = posix.join(posix.dirname(configFile), 'docs-sync.lock')
  const lockText = await readText(root, lockFile)
  const lock = parseLock(lockText, lockFile)
  const locked = compareLock(lock.lock, refs.resolved, refUses, lockFile)
  findings.push(...visibility.findings, ...refs.findings, ...lock.findings, ...locked.findings)

  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_SHA: commit, GITHUB_RUN_ID: run } = env
  const desired = await desiredState({
    config,
    sources,
    theme,
    render: renderer,
    read: (file, maxBytes) => readText(root, file, maxBytes),
    resolved: refs.resolved,
    ...(server && repo && commit ? { blobUrl: `${server}/${repo}/blob/${commit}` } : {}),
  })
  const state = await currentState(reader, rootPage, configFile)
  const changes = diff(desired.pages, state.owned, rootPage)
  const titles = new Map<string, string | undefined>()
  for (const op of changes.ops)
    if (op.kind === 'create' || (op.kind === 'update' && op.changes.includes('title')))
      titles.set(op.title, (await reader.pageByTitle(space.id, op.title))?.id)
  findings.push(
    ...desired.findings,
    ...state.findings,
    ...changes.findings,
    ...titleClashes(changes.ops, titles, state.owned),
  )
  if (hasErrors(findings)) return { findings }

  const deviating = new Set(sources.decisions.filter(d => d.meta['deviates-from']).map(d => d.file))
  const ops = classify(changes.ops, deviating)
  const risk = overallRisk(config.approval, ops)
  const touched = new Set(ops.filter(({ op }) => op.kind === 'create' || op.kind === 'update').map(({ op }) => op.key))
  const sha256 = await writeBundle(
    bundlePath,
    {
      version: 1,
      ...(commit ? { commit } : {}),
      ...(run ? { run } : {}),
      site,
      cloudId: connection.cloudId,
      space: { key: space.key, id: space.id },
      root: rootPage,
      approval: config.approval,
      risk,
      visibility: visibility.visibility,
      ops,
      pageIds: Object.fromEntries(state.owned.map(page => [page.key, page.id])),
      pages: desired.pages.filter(page => touched.has(page.key)),
    },
    desired.images,
    locked.next,
  )
  return { findings, outcome: { sha256, risk, ops, lockChanged: formatLock(locked.next) !== lockText } }
}
