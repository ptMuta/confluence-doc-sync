import { error, type Finding } from '../findings.ts'
import { readText } from '../source/files.ts'
import { isFinding, parseYaml, validate } from '../source/yaml.ts'
import { configSchema, type Config } from './schema.ts'

export async function loadConfig(root: string, file: string): Promise<{ config?: Config; findings: Finding[] }> {
  const text = await readText(root, file)
  if (text === undefined) return { findings: [error('config', file, 1, `Config file ${file} is missing`)] }
  const yaml = parseYaml(text, file)
  if (isFinding(yaml)) return { findings: [yaml] }
  const { value, findings } = validate(configSchema, yaml.value, file, yaml.lineOf)
  return value ? { config: value, findings } : { findings }
}
