import type { Config } from '../config/schema.ts'
import type { Finding } from '../findings.ts'
import type { Decision, Page, Sources } from '../source/load.ts'

export interface Context {
  readonly config: Config
  readonly sources: Sources
  readonly tags: ReadonlySet<string> | undefined
  readonly exists: (file: string) => Promise<boolean>
}

export type Rule = (context: Context) => Finding[] | Promise<Finding[]>

export const documents = (sources: Sources): readonly (Page | Decision)[] => [...sources.pages, ...sources.decisions]
