import { loadConfig } from './config/load.ts'
import { vocabularySchema, type Config } from './config/schema.ts'
import type { Renderer } from './diagrams/render/drawio.ts'
import { defaultTheme, themeSchema, type Theme } from './diagrams/theme.ts'
import { error, type Finding } from './findings.ts'
import type { Rule } from './lint/context.ts'
import { content, duplicates, secrets } from './lint/content.ts'
import { decisions } from './lint/decisions.ts'
import { diagrams } from './lint/diagrams.ts'
import { ids } from './lint/ids.ts'
import { links, usage } from './lint/links.ts'
import { refs } from './lint/refs.ts'
import { exists, readText } from './source/files.ts'
import { loadSources } from './source/load.ts'
import { isFinding, parseYaml, validate } from './source/yaml.ts'

const rules: readonly Rule[] = [ids, refs, decisions, content, duplicates, secrets, links, usage, diagrams]

async function loadTheme(root: string, file: string | undefined): Promise<{ theme?: Theme; findings: Finding[] }> {
  if (!file) return { theme: defaultTheme, findings: [] }
  const text = await readText(root, file)
  if (text === undefined) return { findings: [error('config', file, 1, 'Theme file is missing')] }
  const yaml = parseYaml(text, file)
  if (isFinding(yaml)) return { findings: [yaml] }
  const { value, findings } = validate(themeSchema, yaml.value, file, yaml.lineOf)
  return value ? { theme: value, findings } : { findings }
}

async function loadTags(root: string, config: Config): Promise<{ tags?: Set<string>; findings: Finding[] }> {
  const { vocabulary, extra } = config.tags
  if (!vocabulary) return extra.length ? { tags: new Set(extra), findings: [] } : { findings: [] }
  const text = await readText(root, vocabulary)
  if (text === undefined)
    return {
      findings: [
        { rule: 'config', severity: 'error', file: vocabulary, line: 1, message: 'Tag vocabulary is missing' },
      ],
    }
  const yaml = parseYaml(text, vocabulary)
  if (isFinding(yaml)) return { findings: [yaml] }
  const { value, findings } = validate(vocabularySchema, yaml.value, vocabulary, yaml.lineOf)
  return value ? { tags: new Set([...value.tags, ...extra]), findings } : { findings }
}

export async function check(root: string, configFile: string, render?: Renderer): Promise<Finding[]> {
  const { config, findings } = await loadConfig(root, configFile)
  if (!config) return findings
  const [loaded, vocabulary, themed] = await Promise.all([
    loadSources(root, config),
    loadTags(root, config),
    loadTheme(root, config.theme),
  ])
  const setup = [...findings, ...loaded.findings, ...vocabulary.findings, ...themed.findings]
  if (!themed.theme) return setup
  const context = {
    config,
    sources: loaded.sources,
    tags: vocabulary.tags,
    exists: (file: string) => exists(root, file),
    read: (file: string) => readText(root, file),
    theme: themed.theme,
    render,
  }
  const results = await Promise.all(rules.map(async rule => rule(context)))
  return [...setup, ...results.flat()].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule),
  )
}
