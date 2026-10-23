import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { drawioRenderer } from './diagrams/render/drawio.ts'
import { renderFiles } from './diagrams/render/files.ts'
import { themeSchema } from './diagrams/theme.ts'
import { themes } from './diagrams/themes.ts'
import { run } from './run.ts'

const [command, ...args] = process.argv.slice(2)
const themeFile = args[0] === '--theme' ? args.splice(0, 2)[1] : undefined
const [outDir, ...files] = args
if (command === 'render' && outDir) {
  const theme =
    themeFile === undefined
      ? undefined
      : themeFile in themes
        ? themes[themeFile as keyof typeof themes]
        : themeSchema.parse(parse(await readFile(themeFile, 'utf8')))
  await renderFiles(files, outDir, drawioRenderer(), theme)
} else await run()
