export interface FrontMatter {
  readonly yaml: string
  readonly body: string
  readonly bodyLine: number
}

export function splitFrontMatter(text: string): FrontMatter | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!match) return undefined
  const [head, yaml = ''] = match
  return { yaml, body: text.slice(head.length), bodyLine: head.split('\n').length + (head.endsWith('\n') ? 0 : 1) }
}
