const env = name => {
  const value = process.env[name]
  if (!value) throw new Error(`missing ${name}`)
  return value
}
const site = env('CONFLUENCE_SITE')
const R = env('CONFLUENCE_SPIKE_READ_TOKEN')
const cloud = (await (await fetch(`https://${site}/_edge/tenant_info`, { redirect: 'error' })).json()).cloudId
const base = `https://api.atlassian.com/ex/confluence/${cloud}/wiki`
const get = async path =>
  (
    await fetch(base + path, {
      redirect: 'error',
      headers: { Authorization: `Bearer ${R}`, Accept: 'application/json' },
    })
  ).json()
const space = (await get(`/api/v2/spaces?keys=${env('CONFLUENCE_TEST_SPACE')}`)).results[0]
const page = (
  await get(
    `/api/v2/pages?space-id=${space.id}&title=${encodeURIComponent('Spike sample')}&body-format=atlas_doc_format`,
  )
).results[0]
const nodes = []
const walk = node => {
  if (node?.type === 'extension' || node?.type === 'bodiedExtension') nodes.push(node)
  for (const child of node?.content ?? []) walk(child)
}
walk(JSON.parse(page.body.atlas_doc_format.value))
console.log(JSON.stringify(nodes, null, 2))
const attachments = (await get(`/api/v2/pages/${page.id}/attachments`)).results
console.log(
  JSON.stringify(
    attachments.map(({ title, mediaType, comment, fileSize }) => ({ title, mediaType, comment, fileSize })),
    null,
    2,
  ),
)
