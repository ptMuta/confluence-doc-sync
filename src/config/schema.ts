import { z } from 'zod'
import { themeNames } from '../diagrams/themes.ts'

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
  confluence: z
    .strictObject({
      site: z.string().regex(/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/, 'Must be a <name>.atlassian.net host'),
      'cloud-id': z.uuid().optional(),
      space,
      'root-page': z.coerce.string().regex(/^\d+$/, 'Must be a page id'),
      visibility: z.enum(['space', 'restricted', 'public']).default('space'),
      readers: z.array(z.string().trim().min(1)).min(1).optional(),
    })
    .refine(value => !value.readers || value.visibility === 'restricted', {
      message: 'readers needs visibility: restricted',
      path: ['readers'],
    }),
  approval: z.enum(['none', 'always', 'on-risk']).default('on-risk'),
  approvers: z.array(z.string().trim().min(1)).default([]),
  'self-approval': z.boolean().default(true),
  branch: z.string().trim().min(1).default('main'),
  'diagram-output': z.enum(['image', 'macro']).default('image'),
  'drawio-macro-key': z
    .string()
    .regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/static\/drawio$/, 'Must be <app id>/<environment id>/static/drawio')
    .default('1afdce52-d22e-4d27-84db-5be989c3c83b/92d899e8-452f-4c9b-9f60-823ab11c8253/static/drawio'),
  theme: z.union([z.enum(themeNames), repoPath]).default('nord'),
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
