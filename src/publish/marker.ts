import { createHmac, timingSafeEqual } from 'node:crypto'
import { canonical } from '../plan/hash.ts'

export interface MarkerFields {
  readonly page: string
  readonly source: string
  readonly hash: string
  readonly version: number
}

const mac = (key: string, fields: MarkerFields): string =>
  createHmac('sha256', key)
    .update(canonical({ page: fields.page, source: fields.source, hash: fields.hash, version: fields.version }))
    .digest('hex')

export const signedMarker = (key: string, fields: MarkerFields) => ({
  source: fields.source,
  hash: fields.hash,
  version: fields.version,
  signature: mac(key, fields),
})

export function validSignature(key: string, fields: MarkerFields, signature: string | undefined): boolean {
  if (!signature) return false
  const expected = Buffer.from(mac(key, fields))
  const actual = Buffer.from(signature)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
