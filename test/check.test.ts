import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { check } from '../src/check.ts'

const fixtures = join(import.meta.dirname, 'fixtures')
const config = '.docs-sync/config.yaml'

const base = `system: Payments
confluence: { site: example.atlassian.net, space: DOCS, root-page: 1 }
types: [decisions, requirements, security, logging, monitoring, writing-rules]
`

async function repo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'docs-sync-'))
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), text)
  }
  return root
}

const rules = async (files: Record<string, string>) => (await check(await repo(files), config)).map(f => f.rule)

const decision = (front: string, body: string) => `---
id: DEC-0001
title: A decision
date: 2026-10-22
decision-makers: [team]
${front}
---

${body}`

const sections = `## Context

Context.

## Options

- One
- Two

## Decision

We use one because it is simpler.

## Consequences

Fewer parts.
`

describe('check', () => {
  it('passes the good sample repo', async () => {
    expect(await check(join(fixtures, 'good'), config)).toEqual([])
  })

  it('reports every rule with file and line on the bad sample repo', async () => {
    const findings = await check(join(fixtures, 'bad'), config)
    expect(findings.every(f => f.file && f.line > 0)).toBe(true)
    expect(findings).toMatchSnapshot()
  })

  it('reports a missing config', async () => {
    expect(await check(await repo({}), config)).toEqual([
      { rule: 'config', severity: 'error', file: config, line: 1, message: `Config file ${config} is missing` },
    ])
  })

  it.each([
    ['bad yaml', 'system: [', 'yaml'],
    ['bad schema', 'system: Payments', 'schema'],
  ])('reports a config with %s', async (_, text, rule) => {
    expect(await rules({ [config]: text })).toEqual([rule])
  })

  it('reads the tag vocabulary', async () => {
    const vocabulary = `${base}tags: { vocabulary: tags.yaml, extra: [extra] }\n`
    const page = (tags: string) => `---\ntitle: Page\ntags: [${tags}]\n---\n\nText.\n`
    expect(
      await rules({ [config]: vocabulary, 'tags.yaml': 'tags: [known]', 'docs/a.md': page('known, extra') }),
    ).toEqual([])
    expect(await rules({ [config]: vocabulary, 'tags.yaml': 'tags: [known]', 'docs/a.md': page('other') })).toEqual([
      'tags/unknown',
    ])
    expect(await rules({ [config]: vocabulary })).toEqual(['config'])
    expect(await rules({ [config]: vocabulary, 'tags.yaml': 'tags: [' })).toEqual(['yaml'])
    expect(await rules({ [config]: vocabulary, 'tags.yaml': 'tags: [Bad Tag]' })).toEqual(['schema'])
  })

  it('reports catalog shape problems', async () => {
    expect(await rules({ [config]: base, 'docs/logging.yaml': 'id: LOG-001' })).toEqual(['schema'])
    expect(await rules({ [config]: base, 'docs/logging.yaml': '- [' })).toEqual(['yaml'])
    expect(await rules({ [config]: base, 'docs/logging.yaml': '- id: LOG-1' })).toContain('schema')
  })

  it('allows one option when constrained by an external decision', async () => {
    const ea = `${base}reference-sources:\n  ea: { type: confluence, space: ARCH, folder: X, id-pattern: 'ADR-\\d{3}' }\n`
    const body = sections.replace('- Two\n', '')
    expect(
      await rules({ [config]: ea, 'docs/decisions/DEC-0001.md': decision('constrained-by: [ea:ADR-001]', body) }),
    ).toEqual([])
    expect(
      await rules({ [config]: ea, 'docs/decisions/DEC-0001.md': decision('', body.replace('- One\n', '')) }),
    ).toEqual(['content/empty-section', 'decision/options'])
  })

  it('requires the superseded decision to point back', async () => {
    const second = decision('supersedes: DEC-0001', sections).replace('DEC-0001\ntitle', 'DEC-0002\ntitle')
    expect(
      await rules({
        [config]: base,
        'docs/decisions/DEC-0001.md': decision('', sections),
        'docs/decisions/DEC-0002.md': second,
      }),
    ).toEqual(['decision/supersede'])
  })

  it('checks decision link lists and length', async () => {
    const links = `${sections}\n## Links\n\n- [[DEC-0001]]\n- [Docs](https://example.com)\n- Free text\n`
    expect(await rules({ [config]: base, 'docs/decisions/DEC-0001.md': decision('', links) })).toEqual([
      'decision/ids-only',
    ])
    const long = `${base}lint: { budgets: { decision: 5 } }\n`
    expect(await rules({ [config]: long, 'docs/decisions/DEC-0001.md': decision('', sections) })).toEqual([
      'content/length',
    ])
  })

  it('accepts freeform docs when no types are opted in', async () => {
    const plain = base.replace(/^types: .*\n/m, '')
    const files = {
      [config]: plain,
      'docs/notes.md': 'Some notes without front matter.\n',
      'docs/decisions/whatever.md': 'Not a decision record.\n',
      'docs/logging.yaml': 'id: LOG-001',
      'docs/a.md': '---\ntitle: A\n---\n\n## Empty\n',
    }
    expect(await rules(files)).toEqual([])
    expect(await rules({ ...files, [config]: `${plain}types: [writing-rules]\n` })).toEqual(['content/empty-section'])
    expect(await rules({ ...files, [config]: `${plain}types: [logging]\n` })).toEqual(['schema'])
    expect(await rules({ ...files, [config]: `${plain}types: [decisions]\n` })).toEqual(['frontmatter'])
  })

  it('skips links that need no file check', async () => {
    const page = `---\ntitle: Page\n---\n\n[Top](#top), [Mail](mailto:a@example.com), [Site](https://example.com)\n\n![Remote](https://example.com/a.drawio "Remote")\n`
    expect(await rules({ [config]: base, 'docs/a.md': page })).toEqual(['markdown/link', 'markdown/diagram'])
  })

  it('loads a custom theme and renders diagrams', async () => {
    const themed = `${base}theme: theme.yaml\n`
    const theme =
      'version: 1\nbackground: "#FFFFFF"\nfont: { family: Inter, size: 12, color: "#000000" }\nroles:\n  box: { rounded: 1 }\n'
    const diagram = (role: string) =>
      `<mxGraphModel><root><mxCell id="0"/><mxCell id="a" style="role=${role};" vertex="1" parent="0"/></root></mxGraphModel>`
    const page = '---\ntitle: Page\n---\n\n![Box](a.drawio "Box")\n'
    const files = { [config]: themed, 'theme.yaml': theme, 'docs/page.md': page }
    expect(await rules({ ...files, 'docs/a.drawio': diagram('box') })).toEqual([])
    expect(await rules({ ...files, 'docs/a.drawio': diagram('service') })).toEqual(['diagrams/role'])
    expect(await rules({ [config]: themed })).toEqual(['config'])
    expect(await rules({ [config]: themed, 'theme.yaml': 'version: [' })).toEqual(['yaml'])
    expect(await rules({ [config]: themed, 'theme.yaml': 'version: 1' })).toEqual(['schema', 'schema', 'schema'])
    const fail = () => Promise.reject(new Error('boom'))
    const root = await repo({ [config]: base, 'docs/page.md': page, 'docs/a.drawio': diagram('service') })
    expect((await check(root, config, fail)).map(f => f.message)).toEqual(['boom'])
    const twoPages = `<mxfile><diagram>${diagram('service')}</diagram><diagram>${diagram('service')}</diagram></mxfile>`
    expect(await rules({ [config]: base, 'docs/page.md': page, 'docs/a.drawio': twoPages })).toEqual(['diagrams/pages'])
  })

  it('allows large diagrams up to the configured limit', async () => {
    const image = `data:image/png,${'A'.repeat(1_200_000)}`
    const big = `<mxGraphModel><root><mxCell id="0"/><mxCell id="a" style="role=service;image=${image};" vertex="1" parent="0"/></root></mxGraphModel>`
    const page = '---\ntitle: Page\n---\n\n![Big](a.drawio "Big")\n'
    expect(await rules({ [config]: base, 'docs/page.md': page, 'docs/a.drawio': big })).toEqual([])
    const small = `${base}diagram-max-mb: 1\n`
    expect(await rules({ [config]: small, 'docs/page.md': page, 'docs/a.drawio': big })).toEqual(['diagrams/parse'])
  })

  it('reports the built-in secret patterns', async () => {
    const samples = [
      ['AKIA', 'ABCDEFGHIJKLMNOP'],
      ['-----BEGIN RSA ', 'PRIVATE KEY-----'],
      ['ghp_', 'a'.repeat(36)],
      ['xoxb-', '1234567890ab'],
      ['ATATT', 'x'.repeat(24)],
    ].map(parts => parts.join(''))
    const page = `---\ntitle: Page\n---\n\n${samples.map(s => `- ${s}`).join('\n')}\n`
    expect(await rules({ [config]: base, 'docs/a.md': page })).toEqual(Array(samples.length).fill('content/secret'))
  })
})
