import { z } from 'zod'
import { tag } from '../config/schema.ts'

const text = z.string().trim().min(1)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a YYYY-MM-DD date')
const external = z.string().regex(/^[a-z][a-z0-9-]*:\S+$/, 'Must be <source>:<id>')
const local = z.string().regex(/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+$/, 'Must be an id such as FR-001')
const list = <T extends z.ZodType>(item: T) => z.array(item).min(1)

export const pageSchema = z.strictObject({ title: text.optional(), tags: list(tag).optional() })

export const decisionSchema = (prefix: string) => {
  const id = z.string().regex(new RegExp(`^${prefix}-\\d{4}$`), `Must look like ${prefix}-0001`)
  return z.strictObject({
    id,
    title: text,
    date,
    'decision-makers': list(text),
    tags: list(tag).optional(),
    supersedes: id.optional(),
    'superseded-by': id.optional(),
    retired: z.strictObject({ date, reason: text }).optional(),
    realizes: list(external).optional(),
    'constrained-by': list(external).optional(),
    'deviates-from': list(z.strictObject({ ref: external, reason: text, 'approved-by': text })).optional(),
  })
}

export type PageMeta = z.output<typeof pageSchema> & { readonly title: string }
export type DecisionMeta = z.output<ReturnType<typeof decisionSchema>>

const entry = <S extends z.ZodRawShape>(id: RegExp, example: string, shape: S) =>
  z.strictObject({ id: z.string().regex(id, `Must look like ${example}`), ...shape, tags: list(tag).optional() })

export const catalogSchemas = {
  requirements: entry(/^(?:FR|NFR-[A-Z]{2,6})-\d{3,4}$/, 'FR-001 or NFR-SEC-001', {
    statement: text,
    priority: z.enum(['must', 'should', 'could']),
    verification: text,
    rationale: text.optional(),
    realizes: list(external).optional(),
    'constrained-by': list(external).optional(),
  }),
  security: entry(/^SEC-\d{3,4}$/, 'SEC-001', {
    control: text,
    'applies-to': list(text),
    'enforced-by': text,
    requirement: list(local).optional(),
    realizes: list(external).optional(),
  }),
  logging: entry(/^LOG-\d{3,4}$/, 'LOG-001', {
    events: list(text),
    fields: list(text),
    destination: text,
    retention: text,
    'never-log': list(text).optional(),
    requirement: list(local).optional(),
  }),
  monitoring: entry(/^MON-\d{3,4}$/, 'MON-001', {
    symptom: text,
    signal: text,
    severity: text,
    route: text,
    runbook: text.optional(),
    covers: list(local).optional(),
  }),
}

export type CatalogKind = keyof typeof catalogSchemas

export const catalogKinds = Object.keys(catalogSchemas) as CatalogKind[]

export const linkFields: Record<CatalogKind, readonly string[]> = {
  requirements: ['verification'],
  security: ['enforced-by'],
  logging: [],
  monitoring: ['signal', 'runbook'],
}

export const localRefFields = ['requirement', 'covers'] as const
export const externalRefFields = ['realizes', 'constrained-by'] as const
