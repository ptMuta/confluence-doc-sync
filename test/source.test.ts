import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { configSchema } from '../src/config/schema.ts'
import { listFiles, readText } from '../src/source/files.ts'
import { splitFrontMatter } from '../src/source/frontmatter.ts'
import { isFinding, parseYaml } from '../src/source/yaml.ts'

describe('files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'docs-sync-'))
  const outside = await mkdtemp(join(tmpdir(), 'docs-sync-out-'))
  await writeFile(join(outside, 'secret.md'), 'secret')
  await mkdir(join(root, 'docs'))
  await writeFile(join(root, 'docs', 'big.md'), 'x'.repeat(1_000_001))
  await symlink(join(outside, 'secret.md'), join(root, 'docs', 'link.md'))
  await symlink(outside, join(root, 'away'))

  it('refuses symlinks, large files and paths outside the repository', async () => {
    await expect(readText(root, 'docs/link.md')).rejects.toThrow('docs/link.md is not a regular file')
    await expect(readText(root, 'docs/big.md')).rejects.toThrow('larger than')
    await expect(readText(root, 'away/secret.md')).rejects.toThrow('away/secret.md is outside the repository')
    await expect(listFiles(root, 'away')).rejects.toThrow('away is outside the repository')
    await expect(readText(root, 'docs')).rejects.toThrow('docs is not a regular file')
    expect(await listFiles(root, 'docs')).toEqual(['docs/big.md'])
    expect(await listFiles(root, 'missing')).toEqual([])
    expect(await readText(root, 'missing.md')).toBeUndefined()
  })
})

describe('splitFrontMatter', () => {
  it('finds the body line', () => {
    expect(splitFrontMatter('---\r\na: 1\r\n---\r\nBody')).toEqual({ yaml: 'a: 1', body: 'Body', bodyLine: 4 })
    expect(splitFrontMatter('---\na: 1\n---')).toEqual({ yaml: 'a: 1', body: '', bodyLine: 4 })
    expect(splitFrontMatter('No front matter')).toBeUndefined()
  })
})

describe('parseYaml', () => {
  it('refuses aliases and custom tags', () => {
    const alias = parseYaml('a: &x 1\nb: *x\n', 'a.yaml')
    expect(isFinding(alias) && alias.message).toBe('YAML aliases are not allowed')
    expect(isFinding(parseYaml('a: !!js/function x\n', 'a.yaml'))).toBe(true)
    expect(isFinding(parseYaml('a: 1\na: 2\n', 'a.yaml'))).toBe(true)
  })

  it('maps paths to lines', () => {
    const yaml = parseYaml('a:\n  b: [1, 2]\n', 'a.yaml', 3)
    if (isFinding(yaml)) throw new Error('unexpected')
    expect([yaml.lineOf(['a', 'b']), yaml.lineOf(['a', 'c']), yaml.lineOf([])]).toEqual([4, 4, 3])
  })
})

describe('configSchema', () => {
  const base = { system: 'S', confluence: { site: 'a.atlassian.net', space: 'DOCS', 'root-page': 1 } }
  it('applies defaults', () => {
    const config = configSchema.parse(base)
    expect(config.confluence['root-page']).toBe('1')
    expect(config.decisions).toEqual({ label: 'Decision', 'id-prefix': 'DEC', folder: 'docs/decisions' })
    expect(config.lint.budgets).toEqual({ decision: 400, 'catalog-entry': 80, summary: 60 })
  })
  it.each([
    { docs: '../up' },
    { docs: '/abs' },
    { lint: { 'deny-patterns': ['('] } },
    { confluence: { ...base.confluence, site: 'evil.example.com' } },
  ])('refuses %j', extra => {
    expect(configSchema.safeParse({ ...base, ...extra }).success).toBe(false)
  })
})
