import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { formatLock, type Lock } from '../refs/lock.ts'
import type { DesiredPage, Image } from './desired.ts'
import type { Classified, Risk } from './diff.ts'
import { canonical, sha256 } from './hash.ts'
import type { Visibility } from './visibility.ts'

export interface Plan {
  readonly version: 1
  readonly commit?: string
  readonly run?: string
  readonly site: string
  readonly cloudId: string
  readonly space: { readonly key: string; readonly id: string }
  readonly root: string
  readonly approval: string
  readonly risk: Risk
  readonly visibility: Visibility
  readonly ops: readonly Classified[]
  readonly pageIds: Readonly<Record<string, string>>
  readonly pages: readonly DesiredPage[]
}

export async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter(entry => entry.isFile())
    .map(entry => relative(dir, join(entry.parentPath, entry.name)).split('\\').join('/'))
    .sort()
}

export const hashFiles = (entries: readonly (readonly [string, Buffer])[]): string =>
  sha256(
    [...entries]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([file, data]) => `${sha256(data)}  ${file}\n`)
      .join(''),
  )

async function bundleHash(dir: string): Promise<string> {
  return hashFiles(
    await Promise.all((await files(dir)).map(async file => [file, await readFile(join(dir, file))] as const)),
  )
}

export async function writeBundle(
  dir: string,
  plan: Plan,
  images: ReadonlyMap<string, Image>,
  lock: Lock,
): Promise<string> {
  await rm(dir, { recursive: true, force: true })
  await mkdir(join(dir, 'images'), { recursive: true })
  const used = new Set(plan.pages.flatMap(page => page.attachments))
  await writeFile(join(dir, 'plan.json'), `${canonical(plan)}\n`)
  await writeFile(join(dir, 'docs-sync.lock'), formatLock(lock))
  for (const name of used) {
    const image = images.get(name)
    if (image) await writeFile(join(dir, 'images', name), image.data)
  }
  return bundleHash(dir)
}
