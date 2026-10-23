import { HttpError, ScopeError, type Http } from './http/client.ts'
import { scopeFor } from './reader.ts'

export async function missingScopes(http: Http, paths: readonly string[]): Promise<string[]> {
  const missing = await Promise.all(
    paths.map(async path => {
      try {
        await http.get(path)
        return undefined
      } catch (cause) {
        if (cause instanceof ScopeError) return scopeFor(path)
        if (cause instanceof HttpError) return undefined
        throw cause
      }
    }),
  )
  return [...new Set(missing.filter(scope => scope !== undefined))].sort()
}
