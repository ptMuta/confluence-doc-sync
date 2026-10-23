import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config/load.ts'
import type { Resolver } from '../src/render/adf.ts'
import { renderPages } from '../src/render/pages.ts'
import { loadSources } from '../src/source/load.ts'

const root = 'test/fixtures/good'
const site = 'https://example.atlassian.net/wiki'

const titles: Record<string, string> = {
  'ea:ADR-007': 'ADR-007 Use paired regions',
  'ea:ADR-012': 'ADR-012 Keep data off the internet',
  'ea:ADR-031': 'ADR-031 Stop on leaked secrets',
}

const resolver = (kind: 'image' | 'macro'): Resolver => ({
  ref: id =>
    id.startsWith('ea:')
      ? { href: `${site}/pages/${id.slice(3)}`, title: titles[id] ?? id }
      : { href: `${site}/x/${id}` },
  path: path =>
    path.startsWith('docs/') ? `${site}/page/${path}` : `https://github.com/acme/payments/blob/main/${path}`,
  diagram: path =>
    kind === 'image'
      ? { kind, id: `file-${path}`, collection: 'contentId-1', width: 1200, height: 600 }
      : { kind, extensionKey: 'app/env/static/drawio', name: path, pageId: '1' },
})

async function render(kind: 'image' | 'macro') {
  const { config } = await loadConfig(root, '.docs-sync/config.yaml')
  if (!config) throw new Error('no config')
  const { sources } = await loadSources(root, config)
  return renderPages(config, sources, resolver(kind))
}

describe('renderPages', () => {
  it('matches the golden ADF for every page', async () => {
    const pages = await render('image')
    expect(pages.map(page => [page.key, page.title, page.parent ?? '-', page.labels.join(' ')])).toMatchSnapshot()
    for (const page of pages)
      await expect(`${JSON.stringify(page.body, null, 2)}\n`).toMatchFileSnapshot(
        `golden/${page.key.replace(/[^a-z0-9.-]+/gi, '_')}.json`,
      )
  })

  it('renders diagrams as draw.io macros when asked', async () => {
    const overview = (await render('macro')).find(page => page.key === 'docs/overview.md')
    expect(JSON.stringify(overview?.body)).toContain('"extensionKey":"app/env/static/drawio"')
  })
})
