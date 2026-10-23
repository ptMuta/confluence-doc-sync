import { spawn } from 'node:child_process'
import { access, chown, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type Renderer = (xml: string, maxBytes?: number) => Promise<Buffer>

const renderUser = 10001
const timeout = 60_000
const path = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

function exec(command: string, args: readonly string[], home: string, asRoot: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: home,
      env: { PATH: path, HOME: home },
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout,
      killSignal: 'SIGKILL',
      ...(asRoot ? { uid: renderUser, gid: renderUser } : {}),
    })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2000)
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`Renderer failed (${signal ?? `exit ${String(code)}`}): ${stderr.trim()}`))
    })
  })
}

export function drawioRenderer(command: readonly string[] = ['xvfb-run', '-a', 'drawio']): Renderer {
  const [program = '', ...prefix] = command
  return async (xml, maxBytes = 50_000_000) => {
    const home = await mkdtemp(join(tmpdir(), 'docs-sync-render-'))
    try {
      const input = join(home, 'diagram.drawio')
      const output = join(home, 'diagram.png')
      await writeFile(input, xml)
      const asRoot = process.getuid?.() === 0
      if (asRoot) {
        await chown(home, renderUser, renderUser)
        await chown(input, renderUser, renderUser)
      }
      const args = ['--export', '--format', 'png', '--scale', '2', '--border', '16', '--output', output, input]
      await exec(
        program,
        [...prefix, ...args, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
        home,
        asRoot,
      )
      const { size } = await stat(output)
      if (size > maxBytes) throw new Error(`Rendered PNG is larger than ${String(maxBytes)} bytes`)
      return await readFile(output)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  }
}

export async function findRenderer(binary = '/usr/bin/drawio'): Promise<Renderer | undefined> {
  try {
    await access(binary)
    return drawioRenderer()
  } catch {
    return undefined
  }
}
