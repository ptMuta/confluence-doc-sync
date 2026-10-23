export type Style = ReadonlyMap<string, string | undefined>

export function parseStyle(text: string): Map<string, string | undefined> {
  const style = new Map<string, string | undefined>()
  for (const part of text.split(';')) {
    if (!part.trim()) continue
    const index = part.indexOf('=')
    if (index < 0) style.set(part.trim(), undefined)
    else style.set(part.slice(0, index).trim(), part.slice(index + 1))
  }
  return style
}

export const formatStyle = (style: Style): string =>
  [...style].map(([key, value]) => (value === undefined ? `${key};` : `${key}=${value};`)).join('')
