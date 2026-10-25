const modes = ['check', 'plan', 'publish'] as const
export type Mode = (typeof modes)[number]

const gated = [
  'confluence-client-id',
  'confluence-client-secret',
  'bundle-path',
  'expected-bundle-sha256',
  'environment-tier',
  'ownership-key',
  'change-author',
] as const
type Gated = (typeof gated)[number]

const secrets: readonly Gated[] = ['confluence-client-secret', 'ownership-key']

const accepts: Record<Mode, readonly Gated[]> = {
  check: [],
  plan: ['confluence-client-id', 'confluence-client-secret', 'bundle-path'],
  publish: gated,
}

export interface Inputs {
  readonly mode: Mode
  readonly config: string
  readonly values: Readonly<Partial<Record<Gated, string>>>
}

const isMode = (value: string): value is Mode => (modes as readonly string[]).includes(value)

export function parseInputs(read: (name: string) => string, mask: (value: string) => void): Inputs {
  for (const name of secrets) {
    const value = read(name)
    if (value) mask(value)
  }
  const mode = read('mode')
  if (!isMode(mode)) throw new Error(`Input "mode" must be one of: ${modes.join(', ')}`)
  const set = gated.filter(name => read(name) !== '')
  const refused = set.filter(name => !accepts[mode].includes(name))
  if (refused.length) throw new Error(`Mode "${mode}" does not accept: ${refused.join(', ')}`)
  return {
    mode,
    config: read('config') || '.docs-sync/config.yaml',
    values: Object.fromEntries(set.map(name => [name, read(name)])),
  }
}
