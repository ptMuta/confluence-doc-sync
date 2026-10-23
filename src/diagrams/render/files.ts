import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parseDrawio } from '../parse.ts'
import { prepare } from '../prepare.ts'
import { defaultTheme, type Theme } from '../theme.ts'
import type { Renderer } from './drawio.ts'

export async function renderFiles(
  files: readonly string[],
  outDir: string,
  render: Renderer,
  theme: Theme = defaultTheme,
): Promise<void> {
  for (const file of files) {
    const [page] = parseDrawio(await readFile(file, 'utf8'))
    if (!page) throw new Error(`${file} has no pages`)
    const { xml, problems } = prepare(page, theme)
    const errors = problems.filter(problem => problem.severity === 'error')
    if (errors.length) throw new Error(`${file}: ${errors.map(problem => problem.message).join('; ')}`)
    await writeFile(join(outDir, `${basename(file, '.drawio')}.png`), await render(xml))
  }
}
