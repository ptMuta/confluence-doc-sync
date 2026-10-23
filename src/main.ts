import { drawioRenderer } from './diagrams/render/drawio.ts'
import { renderFiles } from './diagrams/render/files.ts'
import { run } from './run.ts'

const [command, outDir, ...files] = process.argv.slice(2)
if (command === 'render' && outDir) await renderFiles(files, outDir, drawioRenderer())
else await run()
