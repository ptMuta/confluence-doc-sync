import { describe, expect, it, vi } from 'vitest'
import { parseInputs } from '../src/inputs.ts'

const reader = (values: Record<string, string>) => (name: string) => values[name] ?? ''

describe('parseInputs', () => {
  it.each([
    ['check', {}],
    ['plan', { 'confluence-token': 't', 'bundle-path': 'b' }],
    [
      'publish',
      {
        'confluence-token': 't',
        'bundle-path': 'b',
        'expected-bundle-sha256': 'h',
        'environment-tier': 'reviewed',
        'ownership-key': 'k',
      },
    ],
  ])('accepts the inputs of %s', (mode, values) => {
    const inputs = parseInputs(reader({ mode, ...values }), vi.fn())
    expect(inputs).toEqual({ mode, config: '.docs-sync/config.yaml', values })
  })

  it('uses the given config path', () => {
    expect(parseInputs(reader({ mode: 'check', config: 'docs.yaml' }), vi.fn()).config).toBe('docs.yaml')
  })

  it.each(['', 'deploy', 'CHECK'])('refuses mode %j', mode => {
    expect(() => parseInputs(reader({ mode }), vi.fn())).toThrow('Input "mode" must be one of: check, plan, publish')
  })

  it.each([
    ['check', 'confluence-token'],
    ['check', 'bundle-path'],
    ['plan', 'ownership-key'],
    ['plan', 'expected-bundle-sha256'],
    ['plan', 'environment-tier'],
  ])('refuses %s with %s', (mode, name) => {
    expect(() => parseInputs(reader({ mode, [name]: 'x' }), vi.fn())).toThrow(`Mode "${mode}" does not accept: ${name}`)
  })

  it('masks secrets before refusing anything', () => {
    const mask = vi.fn()
    expect(() =>
      parseInputs(reader({ mode: 'nope', 'confluence-token': 'token', 'ownership-key': 'key' }), mask),
    ).toThrow()
    expect(mask.mock.calls).toEqual([['token'], ['key']])
  })

  it('never puts values in errors', () => {
    expect(() => parseInputs(reader({ mode: 'check', 'confluence-token': 'secret-value' }), vi.fn())).toThrow(
      /^(?!.*secret-value)/,
    )
  })
})
