import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const base = process.argv[2]
const require = createRequire(import.meta.url)
const pkg = require(`${base}/node_modules/dsh-plugin-list-search/package.json`)
console.log('installed:', pkg.name, pkg.version, '| dsh.client:', JSON.stringify(pkg.dsh.client))

const source = readFileSync(`${base}/node_modules/dsh-plugin-list-search/lib/client.js`, 'utf8')
let row = null
globalThis.window = { __ModuleLoader__: { load(r) { row = r } } }
new Function(source)()
console.log('bundle id:', row?.id, '| factory:', typeof row?.factory)
const mod = row.factory()
console.log('apply:', typeof mod.apply, '| inject:', JSON.stringify(mod.inject))
console.log('toolbar selector:', mod.__internals.SELECTORS.toolbar, '| hidden attr:', mod.__internals.CSS.includes('data-dsh-list-search-hidden'))
