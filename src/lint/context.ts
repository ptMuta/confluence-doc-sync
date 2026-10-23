import type { Config } from '../config/schema.ts'
import type { Renderer } from '../diagrams/render/drawio.ts'
import type { Theme } from '../diagrams/theme.ts'
import type { Finding } from '../findings.ts'
import type { Decision, Page, Sources } from '../source/load.ts'

export interface Context {
  readonly config: Config
  readonly sources: Sources
  readonly tags: ReadonlySet<string> | undefined
  readonly exists: (file: string) => Promise<boolean>
  readonly read: (file: string, maxBytes?: number) => Promise<string | undefined>
  readonly theme: Theme
  readonly render: Renderer | undefined
}

export type Rule = (context: Context) => Finding[] | Promise<Finding[]>

export const documents = (sources: Sources): readonly (Page | Decision)[] => [...sources.pages, ...sources.decisions]
