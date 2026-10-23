import { createHash } from 'node:crypto'

const sorted = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sorted)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sorted(item)]),
    )
  return value
}

export const canonical = (value: unknown): string => JSON.stringify(sorted(value))

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')
