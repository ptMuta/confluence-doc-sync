import { XMLParser } from 'fast-xml-parser'

export interface XNode {
  readonly tag: string
  readonly attrs: Readonly<Record<string, string>>
  readonly children: readonly XNode[]
  readonly text: string
}

type Raw = Record<string, unknown>

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  processEntities: true,
  htmlEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  preserveOrder: true,
})

function convert(raw: Raw): XNode | undefined {
  const tag = Object.keys(raw).find(key => key !== ':@' && key !== '#text')
  if (!tag) return undefined
  const content = (raw[tag] ?? []) as Raw[]
  const attrs = (raw[':@'] ?? {}) as Record<string, string>
  return {
    tag,
    attrs,
    children: content.map(convert).filter(node => node !== undefined),
    text: content.map(item => (typeof item['#text'] === 'string' ? item['#text'] : '')).join(''),
  }
}

export function parseXml(text: string): XNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('DOCTYPE and entity declarations are not allowed')
  const [root] = (parser.parse(text) as Raw[]).map(convert).filter(node => node !== undefined)
  if (!root) throw new Error('The file has no XML element')
  return root
}

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\n', '&#10;')

export const element = (tag: string, attrs: Readonly<Record<string, string | undefined>>, children = ''): string => {
  const list = Object.entries(attrs)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join('')
  return children ? `<${tag}${list}>${children}</${tag}>` : `<${tag}${list}/>`
}
