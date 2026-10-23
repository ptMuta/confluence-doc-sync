import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseDrawio } from '../src/diagrams/parse.ts'
import { prepare } from '../src/diagrams/prepare.ts'
import { drawioRenderer, findRenderer } from '../src/diagrams/render/drawio.ts'
import { renderFiles } from '../src/diagrams/render/files.ts'
import { defaultTheme } from '../src/diagrams/theme.ts'

const fixtures = join(import.meta.dirname, 'fixtures')
const sample = (name: string) => readFile(join(fixtures, 'diagrams', `${name}.drawio`), 'utf8')
const fake = drawioRenderer([process.execPath, join(fixtures, 'fake-drawio.mjs')])

const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>'

describe('parseDrawio', () => {
  it('reads plain, compressed and bare files', async () => {
    expect(parseDrawio(await sample('showcase'))[0]?.cells).toHaveLength(19)
    const packed = deflateRawSync(encodeURIComponent(model)).toString('base64')
    expect(parseDrawio(`<mxfile><diagram name="P">${packed}</diagram></mxfile>`)[0]).toMatchObject({
      name: 'P',
      id: 'page-1',
    })
    expect(parseDrawio(model)).toHaveLength(1)
  })

  it.each([
    ['<!DOCTYPE x [<!ENTITY a "b">]><mxfile/>', 'DOCTYPE and entity declarations are not allowed'],
    ['', 'The file has no XML element'],
    ['<mxfile/>', 'The file has no draw.io pages'],
    ['<mxfile><diagram> </diagram></mxfile>', 'A page has no content'],
    [
      `<mxfile><diagram>${deflateRawSync('%3Cother%2F%3E').toString('base64')}</diagram></mxfile>`,
      'A compressed page does not hold a graph model',
    ],
    ['<mxGraphModel><root><mxCell/></root></mxGraphModel>', 'A cell has no id'],
    [`<mxGraphModel><root>${'<mxCell id="x"/>'.repeat(10_001)}</root></mxGraphModel>`, 'more than 10000 cells'],
  ])('refuses %#', (text, message) => {
    expect(() => parseDrawio(text)).toThrow(message)
  })
})

describe('prepare', () => {
  it('themes the showcase without problems', async () => {
    const [page] = parseDrawio(await sample('showcase'))
    if (!page) throw new Error('no page')
    const { xml, problems } = prepare(page, defaultTheme)
    expect(problems).toEqual([])
    expect(xml).toContain('background="#FFFFFF"')
    expect(xml).toContain('<Array as="points"><mxPoint x="400" y="20" as="undefined"/>'.replace(' as="undefined"', ''))
    expect(xml).not.toContain('html=1')
  })

  it('reports and strips unsafe content', async () => {
    const [page] = parseDrawio(await sample('unsafe'))
    if (!page) throw new Error('no page')
    const { xml, problems } = prepare(page, defaultTheme)
    expect(problems.map(problem => `${problem.rule} ${problem.message}`)).toEqual([
      'diagrams/unsafe Cell a: label has script content',
      'diagrams/unsafe Cell a: link "javascript:alert(1)" must use https',
      'diagrams/style Cell a: the theme replaces fillColor',
      'diagrams/role Cell b: set a role in its style, e.g. role=service',
      'diagrams/unsafe Cell b: images must be embedded PNG, JPEG, GIF or WebP data, or built-in draw.io icons',
      'diagrams/role Cell c: unknown role "wizard"',
    ])
    expect(xml).not.toMatch(/onerror|onload|javascript|evil\.example|<img/)
    expect(xml).toContain('value="Bold"')
  })

  it('allows built-in draw.io icons only', () => {
    const images = ['img/lib/azure2/compute/Function_Apps.svg', 'img/lib/../../etc/x.svg', 'file:///img/lib/a.svg']
    const [page] = parseDrawio(
      `<mxGraphModel><root>${images.map((image, index) => `<mxCell id="${String(index)}" style="role=icon;image=${image};" vertex="1" parent="1"/>`).join('')}</root></mxGraphModel>`,
    )
    if (!page) throw new Error('no page')
    const { xml, problems } = prepare(page, defaultTheme)
    expect(problems.map(problem => problem.message.slice(0, 7))).toEqual(['Cell 1:', 'Cell 2:'])
    expect(xml).toContain('Function_Apps.svg')
  })

  it('keeps https links and decodes HTML labels', () => {
    const [page] = parseDrawio(
      '<mxGraphModel><root><UserObject label="A &amp;amp; B&lt;div&gt;C&amp;#33;&amp;nbsp;&amp;lt;&amp;gt;&amp;quot;&amp;#39;&lt;/div&gt;" link="https://example.com" id="a"><mxCell style="role=service;html=1;fontSize=20;" vertex="1" parent="1"/></UserObject></root></mxGraphModel>',
    )
    if (!page) throw new Error('no page')
    const { xml, problems } = prepare(page, defaultTheme)
    expect(problems.map(problem => problem.message)).toEqual(['Cell a: the theme replaces fontSize'])
    expect(xml).toContain('<UserObject label="A &amp; B&#10;C! &lt;&gt;&quot;\'" link="https://example.com" id="a">')
  })
})

describe('renderer', () => {
  it('runs the renderer with an empty environment', async () => {
    const result = JSON.parse((await fake('<mxfile/>')).toString('utf8')) as {
      env: Record<string, string>
      uid: number
      args: string[]
    }
    expect(Object.keys(result.env).filter(key => !['PATH', 'HOME'].includes(key) && !key.startsWith('__CF'))).toEqual(
      [],
    )
    if (process.getuid?.() === 0) expect(result.uid).toBe(10001)
    expect(result.args).toContain('--no-sandbox')
  })

  it('reports renderer failures', async () => {
    await expect(fake('FAIL')).rejects.toThrow('Renderer failed (exit 1): render failed')
    await expect(drawioRenderer(['/nonexistent/drawio'])('<mxfile/>')).rejects.toThrow('ENOENT')
  })

  it('finds the renderer only when draw.io is installed', async () => {
    expect(await findRenderer('/nonexistent/drawio')).toBeUndefined()
    expect(await findRenderer(process.execPath)).toBeTypeOf('function')
  })

  it('renders files and refuses unsafe ones', async () => {
    const out = await mkdtemp(join(tmpdir(), 'docs-sync-out-'))
    await renderFiles([join(fixtures, 'diagrams', 'showcase.drawio')], out, fake)
    expect(JSON.parse(await readFile(join(out, 'showcase.png'), 'utf8'))).toHaveProperty('args')
    await expect(renderFiles([join(fixtures, 'diagrams', 'unsafe.drawio')], out, fake)).rejects.toThrow(
      'label has script content',
    )
  })
})
