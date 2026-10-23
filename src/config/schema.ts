import { z } from 'zod'

const repoPath = z
  .string()
  .min(1)
  .refine(
    path => !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..'),
    'Must be a relative path inside the repository',
  )

const pattern = z.string().refine(source => {
  try {
    return RegExp(source, 'u').source.length > 0
  } catch {
    return false
  }
}, 'Must be a valid regular expression')

export const tag = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be lowercase words joined by hyphens')
const space = z.string().regex(/^~?[A-Za-z0-9]+$/, 'Must be a space key')
const count = z.number().int().positive()

const referenceSource = z.strictObject({
  type: z.literal('confluence'),
  space,
  folder: z.string().trim().min(1),
  'id-pattern': pattern,
  match: z.enum(['title-prefix', 'page-property', 'label']).default('title-prefix'),
  lifecycle: z
    .record(
      tag,
      z.union([
        z.strictObject({ folder: z.string().trim().min(1) }),
        z.strictObject({ label: z.string().trim().min(1) }),
      ]),
    )
    .optional(),
})

export const configSchema = z.strictObject({
  system: z.string().trim().min(1),
  confluence: z.strictObject({
    site: z.string().regex(/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/, 'Must be a <name>.atlassian.net host'),
    'cloud-id': z.uuid().optional(),
    space,
    'root-page': z.coerce.string().regex(/^\d+$/, 'Must be a page id'),
  }),
  approval: z.enum(['none', 'always', 'on-risk']).default('on-risk'),
  approvers: z.array(z.string().trim().min(1)).default([]),
  'diagram-output': z.enum(['image', 'macro']).default('image'),
  theme: repoPath.optional(),
  'diagram-max-mb': z.number().int().positive().max(1000).default(50),
  docs: repoPath.default('docs'),
  decisions: z
    .strictObject({
      label: z.string().trim().min(1).default('Decision'),
      'id-prefix': z
        .string()
        .regex(/^[A-Z]{2,10}$/, 'Must be 2 to 10 capital letters')
        .default('DEC'),
      folder: repoPath.default('docs/decisions'),
    })
    .prefault({}),
  catalogs: z
    .strictObject({
      requirements: repoPath.default('docs/requirements.yaml'),
      security: repoPath.default('docs/security.yaml'),
      logging: repoPath.default('docs/logging.yaml'),
      monitoring: repoPath.default('docs/monitoring.yaml'),
    })
    .prefault({}),
  tags: z.strictObject({ vocabulary: repoPath.optional(), extra: z.array(tag).default([]) }).prefault({}),
  'reference-sources': z
    .record(z.string().regex(/^[a-z][a-z0-9-]*$/, 'Must be lowercase letters, digits and hyphens'), referenceSource)
    .default({}),
  lint: z
    .strictObject({
      budgets: z
        .strictObject({
          decision: count.default(400),
          'catalog-entry': count.default(80),
          summary: count.default(60),
        })
        .prefault({}),
      filler: z.array(z.string().trim().min(1)).default([]),
      'deny-patterns': z.array(pattern).default([]),
    })
    .prefault({}),
})

export type Config = z.output<typeof configSchema>

export const vocabularySchema = z.strictObject({ tags: z.array(tag) })
