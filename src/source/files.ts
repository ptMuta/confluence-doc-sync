import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const maxBytes = 1_000_000

const missing = (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'ENOENT'

async function inside(root: string, path: string): Promise<void> {
  const [base, real] = await Promise.all([realpath(root), realpath(path)])
  if (real !== base && !real.startsWith(base + sep))
    throw new Error(`${relative(root, path)} is outside the repository`)
}

export async function readText(root: string, file: string): Promise<string | undefined> {
  const path = join(root, file)
  let stat
  try {
    stat = await lstat(path)
  } catch (cause) {
    if (missing(cause)) return undefined
    throw cause
  }
  if (!stat.isFile()) throw new Error(`${file} is not a regular file`)
  if (stat.size > maxBytes) throw new Error(`${file} is larger than ${String(maxBytes)} bytes`)
  await inside(root, path)
  return readFile(path, 'utf8')
}

export async function listFiles(root: string, dir: string): Promise<string[]> {
  const path = join(root, dir)
  try {
    await inside(root, path)
  } catch (cause) {
    if (missing(cause)) return []
    throw cause
  }
  const entries = await readdir(path, { recursive: true, withFileTypes: true })
  return entries
    .filter(entry => entry.isFile())
    .map(entry => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
}

export async function exists(root: string, file: string): Promise<boolean> {
  try {
    await lstat(join(root, file))
    return true
  } catch {
    return false
  }
}
