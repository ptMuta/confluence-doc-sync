import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const output = args[args.indexOf('--output') + 1]
const input = args[args.indexOf('--output') + 2]
if (readFileSync(input, 'utf8').includes('FAIL')) {
  process.stderr.write('render failed')
  process.exit(1)
}
writeFileSync(output, JSON.stringify({ env: process.env, uid: process.getuid(), args }))
