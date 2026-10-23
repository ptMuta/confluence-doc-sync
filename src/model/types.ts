export type Inline =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'strong' | 'emphasis' | 'strike'; readonly children: readonly Inline[] }
  | { readonly type: 'code'; readonly value: string }
  | { readonly type: 'link'; readonly href: string; readonly children: readonly Inline[] }
  | { readonly type: 'ref'; readonly id: string }
  | { readonly type: 'break' }

export type Block =
  | { readonly type: 'heading'; readonly level: number; readonly children: readonly Inline[]; readonly line: number }
  | { readonly type: 'paragraph'; readonly children: readonly Inline[]; readonly line: number }
  | {
      readonly type: 'list'
      readonly ordered: boolean
      readonly items: readonly (readonly Block[])[]
      readonly line: number
    }
  | { readonly type: 'table'; readonly rows: readonly (readonly (readonly Inline[])[])[]; readonly line: number }
  | { readonly type: 'code'; readonly language?: string; readonly value: string; readonly line: number }
  | {
      readonly type: 'diagram'
      readonly src: string
      readonly alt: string
      readonly caption: string
      readonly line: number
    }
  | {
      readonly type: 'callout'
      readonly kind: 'info' | 'warning'
      readonly children: readonly Block[]
      readonly line: number
    }
