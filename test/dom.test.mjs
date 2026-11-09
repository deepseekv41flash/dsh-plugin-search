/**
 * DOM 行为测试（jsdom）。
 *
 * 目的：在**不启动 GUI** 的前提下，验证 lib/client.js 对「插件」页真实 DOM 结构的
 * 行为 —— 搜索条落位（工具条内 / 页头下方一行两个落点）、关键词过滤、分组隐藏、
 * 非「已安装」页签的退化落位、React 重挂后重算、切详情页撤走、卸载清理，以及
 * 「落点判断把搜索条自己当成锚点导致自激循环」这条回归。
 *
 * 夹具的层级与 data-* 属性照抄 @deepseek-ai/dsh-client-ui-plugin-manager 的 JSX
 * （PluginManagerPage / renderGroup / PackageCard / ItemCard），版本取 DSH NEXT
 * 2.0.22 上的实际结构：`section[data-plugin-panel]` → `div[data-plugin-body]`
 * → `div[data-plugin-bar]` → `header`（内含 pageHeading 与 `[data-plugin-toolbar]`）。
 * **这些属性就是被测代码赖以定位的契约**：夹具改了、代码没跟上，测试就该红。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { JSDOM } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '..', 'lib', 'client.js')
const bundleSource = readFileSync(bundlePath, 'utf8')

// ── 结果收集 ────────────────────────────────────────────────────────────────
const results = []
function rec(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail === undefined ? undefined : String(detail) })
}

// ── 夹具：与 2.0.22 的 renderGroup / PackageCard / ItemCard 同构 ────────────
const CARDS = {
  basic: [
    { kind: 'package', name: '@deepseek-ai/dsh-basic-bundle', status: 'on', title: '基础能力',
      desc: '会话、文件、终端与常用工具。' },
  ],
  extensions: [
    { kind: 'package', name: '@deepseek-ai/dsh-experimental-agent-team-bundle', status: 'off',
      title: '智能体团队', desc: '启用团队协作、团队工具、成员列表和共享任务看板。' },
    { kind: 'package', name: '@deepseek-ai/dsh-experimental-schedule-bundle', status: 'off',
      title: '自动化任务', desc: '按设定的时间或周期，在会话中自动执行任务。' },
    { kind: 'item', id: 'panel-team', status: 'off', title: '团队面板', desc: '在侧栏里查看团队成员与共享任务。' },
  ],
  bundles: [
    { kind: 'package', name: 'dsh-better-sidebar', status: 'on', title: 'Better Sidebar',
      desc: '更好用的右侧边栏——文件树、编辑器、变更与侧边对话。' },
    { kind: 'package', name: 'dsh-taskboard', status: 'on', title: 'dsh-taskboard',
      desc: 'DSH 任务看板：人在 Web GUI 看板上实时看到同样数据。' },
    { kind: 'package', name: 'dsh-thoughtdag', status: 'on', title: 'dsh-thoughtdag',
      desc: 'why layer: evidence from session logs about past agent conversations.' },
  ],
}
const GROUP_IDS = ['basic', 'extensions', 'bundles']
const TOTAL = GROUP_IDS.reduce((n, id) => n + CARDS[id].length, 0)

function buildCard(doc, c) {
  const li = doc.createElement('li')
  li.className = 'card cardLink'
  if (c.kind === 'item') li.setAttribute('data-plugin-item', c.id)
  else li.setAttribute('data-plugin-package', c.name)
  li.setAttribute('data-plugin-status', c.status)
  const head = doc.createElement('div')
  head.className = 'cardHead'
  const main = doc.createElement('div')
  main.className = 'cardMain'
  const title = doc.createElement('button')
  title.type = 'button'
  title.className = 'cardTitle'
  title.textContent = c.title
  const desc = doc.createElement('span')
  desc.className = 'cardDesc'
  desc.textContent = c.desc
  main.appendChild(title)
  main.appendChild(desc)
  head.appendChild(main)
  li.appendChild(head)
  return li
}

function buildList(doc, id) {
  const ul = doc.createElement('ul')
  ul.className = 'cards'
  for (const c of CARDS[id]) ul.appendChild(buildCard(doc, c))
  return ul
}

function buildGroup(doc, id) {
  const group = doc.createElement('section')
  group.className = 'group'
  group.setAttribute('data-plugin-scope', 'global')
  group.setAttribute('data-plugin-group', id)
  const head = doc.createElement('div')
  head.className = 'groupHead'
  const h3 = doc.createElement('h3')
  h3.className = 'groupTitle'
  h3.textContent = id
  head.appendChild(h3)
  group.appendChild(head)
  group.appendChild(buildList(doc, id))
  return group
}

/**
 * 一张「插件」页（列表态）。
 * @param toolbarHidden - 非「已安装」页签时外壳给工具条加 hidden。
 */
function buildPage(doc, { toolbarHidden = false } = {}) {
  const panel = doc.createElement('section')
  panel.className = 'page'
  panel.setAttribute('data-plugin-panel', '')

  const body = doc.createElement('div')
  body.className = 'pageBody'
  body.setAttribute('data-plugin-body', '')

  const bar = doc.createElement('div')
  bar.className = 'pageBar'
  bar.setAttribute('data-plugin-bar', '')

  const header = doc.createElement('header')
  header.className = 'pageHead'
  header.setAttribute('data-plugin-page-header', 'list')
  header.setAttribute('data-window-drag', '')

  const heading = doc.createElement('div')
  heading.className = 'pageHeading'
  const h1 = doc.createElement('h1')
  h1.className = 'pageTitle'
  h1.setAttribute('data-plugin-header-part', 'title')
  h1.textContent = '插件'
  const intro = doc.createElement('div')
  intro.className = 'pageIntro'
  intro.setAttribute('data-plugin-header-part', 'intro')
  intro.textContent = '管理插件包：启用、停用、配置与安装。'
  heading.appendChild(h1)
  heading.appendChild(intro)

  const toolbar = doc.createElement('div')
  toolbar.className = 'toolbar'
  toolbar.setAttribute('data-plugin-toolbar', '')
  toolbar.setAttribute('data-plugin-header-part', 'toolbar')
  if (toolbarHidden) toolbar.setAttribute('hidden', '')
  const note = doc.createElement('span')
  note.className = 'updatesNote'
  note.textContent = '全部为最新版本'
  const refresh = doc.createElement('button')
  refresh.type = 'button'
  refresh.className = 'addButton'
  refresh.setAttribute('aria-label', '刷新')
  const add = doc.createElement('button')
  add.type = 'button'
  add.className = 'addButton'
  add.textContent = '添加插件'
  toolbar.appendChild(note)
  toolbar.appendChild(refresh)
  toolbar.appendChild(add)

  const tabs = doc.createElement('div')
  tabs.className = 'pageTabs'
  tabs.setAttribute('data-plugin-header-part', 'tabs')

  header.appendChild(heading)
  header.appendChild(toolbar)
  header.appendChild(tabs)
  bar.appendChild(header)
  body.appendChild(bar)
  for (const id of GROUP_IDS) body.appendChild(buildGroup(doc, id))
  panel.appendChild(body)
  return panel
}

// ── 测试主体 ────────────────────────────────────────────────────────────────
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
})
const { window } = dom
const { document } = window

const registered = {}
window.__ModuleLoader__ = { load(row) { registered[row.id] = row } }
window.eval(bundleSource)

const row = registered['dsh-plugin-list-search']
rec('bundle registered a row', row !== null && row !== undefined)
rec('bundle id is the package name', row && row.id === 'dsh-plugin-list-search')
rec('bundle exposes a factory', row && typeof row.factory === 'function')

const mod = row.factory(() => { throw new Error('this bundle must not require anything') })
rec('factory needs no requires', typeof mod.apply === 'function')

// 假的 client ctx：effect 立即执行并记住 disposer；locale 可控。
let teardown = null
const localeListeners = new Set()
let activeLocale = 'zh-CN'
const ctx = {
  effect(cb) { teardown = cb() },
  locale: {
    getSnapshot: () => ({ active: activeLocale }),
    subscribe(fn) { localeListeners.add(fn); return () => localeListeners.delete(fn) },
  },
}

const app = document.getElementById('app')
app.appendChild(buildPage(document))

let applyError = null
try {
  mod.apply(ctx)
} catch (error) {
  applyError = error
}
rec('apply() did not throw', applyError === null, applyError && applyError.stack)

// ── 辅助 ────────────────────────────────────────────────────────────────────
const BAR = '[data-dsh-list-search]'
const HID = 'data-dsh-list-search-hidden'
// 重算是限速的（SYNC_INTERVAL_MS = 60ms，见 lib/client.js 的 schedule()），
// 所以每个 settle 至少跨过两轮采样。
const settle = async () => {
  await new Promise((r) => setTimeout(r, 90))
  await new Promise((r) => setTimeout(r, 90))
}
const q = (sel) => document.querySelector(sel)
const qa = (sel) => [...document.querySelectorAll(sel)]
const allCards = () => qa('[data-plugin-package], [data-plugin-item]')
const visibleCards = () => allCards().filter((c) => !c.hasAttribute(HID))
const hiddenCount = () => qa(`[${HID}]`).length
const visibleGroups = () => qa('[data-plugin-group]').filter((g) => !g.hasAttribute(HID))
const visibleTitles = () => visibleCards().map((c) => c.querySelector('.cardTitle').textContent)

const bar = q(BAR)
const input = bar && bar.querySelector('input')
const clearBtn = bar && bar.querySelector('.dls-clear')
const status = bar && bar.querySelector('.dls-status')

function type(text) {
  input.value = text
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
}

await settle()

// ══ 1. 挂载与落位（DSH NEXT 2.0.x：进页头工具条） ═══════════════════════════
rec('search bar mounted', bar !== null)
rec('input is type=search', input !== null && input.type === 'search')
rec('bar lands inside [data-plugin-toolbar]', bar && bar.parentNode === q('[data-plugin-toolbar]'),
  bar && bar.parentNode && bar.parentNode.className)
rec('bar is the toolbar first child (left of the buttons)', bar && bar.parentNode.firstElementChild === bar)
rec('bar is NOT inside the measured pageHeading', bar && bar.closest('.pageHeading') === null)
rec('placeholder localized to zh', input && input.placeholder === '搜索插件…', input && input.placeholder)
rec('style tag injected', document.getElementById('dsh-plugin-list-search-style') !== null)
rec('nothing hidden while query is empty', hiddenCount() === 0, hiddenCount())
rec('clear button hidden while empty', clearBtn && clearBtn.hidden === true)
rec('status empty while query is empty', status && status.textContent === '', status && status.textContent)

// ══ 2. 关键词过滤 ═══════════════════════════════════════════════════════════
type('sidebar')
await settle()
rec('"sidebar" leaves exactly one card', visibleCards().length === 1, visibleTitles().join(' | '))
rec('"sidebar" picks the right card', visibleTitles()[0] === 'Better Sidebar', visibleTitles()[0])
rec('a group with no hit is hidden',
  !visibleGroups().some((g) => g.getAttribute('data-plugin-group') === 'basic'),
  visibleGroups().map((g) => g.getAttribute('data-plugin-group')).join(' | '))
rec('a group with a hit stays visible',
  visibleGroups().some((g) => g.getAttribute('data-plugin-group') === 'bundles'))
rec('status shows shown/total', status.textContent === '1 / ' + TOTAL, status.textContent)
rec('clear button appears once typed', clearBtn.hidden === false)

// ══ 3. 描述文字与官方插件卡片（data-plugin-item）也在命中范围 ═══════════════
type('看板')
await settle()
rec('matches by description text',
  visibleTitles().includes('智能体团队') && visibleTitles().includes('dsh-taskboard'),
  visibleTitles().join(' | '))

type('团队面板')
await settle()
rec('data-plugin-item cards are searchable',
  visibleCards().length === 1 && visibleCards()[0].getAttribute('data-plugin-item') === 'panel-team',
  visibleTitles().join(' | '))

// ══ 4. 大小写不敏感 + 包名命中 ══════════════════════════════════════════════
type('THOUGHT')
await settle()
rec('uppercase query matches', visibleTitles().length === 1 && visibleTitles()[0] === 'dsh-thoughtdag',
  visibleTitles().join(' | '))

type('experimental-agent')
await settle()
rec('package name matches even though it is not rendered', visibleTitles().length === 1,
  visibleTitles().join(' | '))

// ══ 5. 多关键词 = AND ═══════════════════════════════════════════════════════
type('taskboard 看板')
await settle()
rec('multi-term AND narrows to one', visibleCards().length === 1, visibleTitles().join(' | '))

type('sidebar 智能体')
await settle()
rec('multi-term AND with no overlap yields nothing', visibleCards().length === 0, visibleTitles().join(' | '))

// ══ 6. 无命中 ═══════════════════════════════════════════════════════════════
type('zzz-no-such-plugin')
await settle()
rec('no match hides every card', visibleCards().length === 0)
rec('no match hides every group', visibleGroups().length === 0)
rec('no match shows the empty hint', status.textContent === '没有匹配的插件', status.textContent)

// ══ 7. 清空恢复 ═════════════════════════════════════════════════════════════
type('')
await settle()
rec('clearing restores every card', visibleCards().length === TOTAL, visibleCards().length)
rec('clearing restores every group', visibleGroups().length === GROUP_IDS.length, visibleGroups().length)
rec('clearing removes every hidden marker', hiddenCount() === 0, hiddenCount())

// ══ 8. 清除按钮 ═════════════════════════════════════════════════════════════
type('taskboard')
await settle()
rec('filter applied before clear', visibleCards().length === 1)
clearBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
await settle()
rec('clear button empties the input', input.value === '')
rec('clear button restores every card', visibleCards().length === TOTAL, visibleCards().length)

// ══ 9. Esc 清空且不冒泡 ═════════════════════════════════════════════════════
type('thoughtdag')
await settle()
let bubbled = false
const spy = () => { bubbled = true }
document.addEventListener('keydown', spy)
input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
await settle()
rec('Escape clears the query', input.value === '' && visibleCards().length === TOTAL, visibleCards().length)
rec('Escape does not bubble to the shell', bubbled === false)
document.removeEventListener('keydown', spy)

// ══ 10. 语言切换保留输入 ════════════════════════════════════════════════════
type('sidebar')
await settle()
activeLocale = 'en-US'
for (const fn of localeListeners) fn()
await settle()
rec('locale switch relabels the placeholder', input.placeholder === 'Search plugins…', input.placeholder)
rec('locale switch keeps the typed query', input.value === 'sidebar')
rec('locale switch keeps the filter applied', visibleCards().length === 1, visibleCards().length)
rec('locale switch relabels the status', status.textContent === '1 / ' + TOTAL, status.textContent)
activeLocale = 'zh-CN'
for (const fn of localeListeners) fn()
await settle()

// ══ 11. React 重挂卡片后自动重算 ═══════════════════════════════════════════
type('sidebar')
await settle()
const group = q('[data-plugin-group="bundles"]')
group.querySelector('ul').remove()
group.appendChild(buildList(document, 'bundles'))
await settle()
rec('filter re-applied after a React remount', visibleCards().length === 1, visibleTitles().join(' | '))
rec('bar survived the remount', q(BAR) === bar)

// ══ 12. 回归：落点锚点不能是搜索条自己（否则自激循环） ══════════════════════
// 把 insertBefore 包一层计数：搜索条在落点稳定后不该再被搬动。
const originalInsertBefore = window.Node.prototype.insertBefore
let barMoves = 0
window.Node.prototype.insertBefore = function (node, ref) {
  if (node instanceof window.Element && node.hasAttribute('data-dsh-list-search')) barMoves++
  return originalInsertBefore.call(this, node, ref)
}
for (let i = 0; i < 3; i++) {
  group.querySelector('.groupTitle').textContent = `bundles ${i}`
  await settle()
}
window.Node.prototype.insertBefore = originalInsertBefore
rec('a settled bar is not re-inserted on every sync (no self-feeding loop)', barMoves === 0, barMoves)
rec('bar still first in the toolbar after those syncs', q('[data-plugin-toolbar]').firstElementChild === bar)

// ══ 13. 工具条从一开始就 hidden（非「已安装」页签）→ 退化到页头下方一行 ═════
// 注意：`hidden` 是属性变更，观察者只监听 childList/characterData —— 外壳切页签时
// 搜索条跟着工具条一起隐藏即可，不需要重排；退化落点覆盖的是「挂载时就不可见」
// 这一种情况，所以换一整张工具条 hidden 的页面来验证。
type('')
await settle()
const body = q('[data-plugin-body]')
const listPanelForTab = q('[data-plugin-panel]')
listPanelForTab.remove()
const hiddenToolbarPage = buildPage(document, { toolbarHidden: true })
app.appendChild(hiddenToolbarPage)
await settle()
const hiddenToolbarBody = hiddenToolbarPage.querySelector('[data-plugin-body]')
const hiddenToolbarBar = hiddenToolbarPage.querySelector('[data-plugin-bar]')
rec('hidden toolbar falls back to a row under the header',
  bar.parentNode === hiddenToolbarBody && bar.previousElementSibling === hiddenToolbarBar,
  bar.parentNode && (bar.parentNode.getAttribute('data-plugin-body') !== null
    ? '[data-plugin-body]'
    : bar.parentNode.className))
hiddenToolbarPage.remove()
app.appendChild(listPanelForTab)
await settle()
rec('bar returns into the toolbar with the normal page', bar.parentNode === q('[data-plugin-toolbar]'))

// ══ 14. 切到详情页（没有卡片）时撤走 ════════════════════════════════════════
type('sidebar')
await settle()
const listPanel = q('[data-plugin-panel]')
listPanel.remove()
const detail = document.createElement('section')
detail.setAttribute('data-plugin-panel', '')
const detailBody = document.createElement('div')
detailBody.setAttribute('data-plugin-body', '')
detailBody.textContent = '详情页'
detail.appendChild(detailBody)
app.appendChild(detail)
await settle()
rec('bar detached on the detail view', q(BAR) === null)
rec('no stale hidden markers on the detail view', hiddenCount() === 0, hiddenCount())
detail.remove()
app.appendChild(listPanel)
await settle()
rec('bar returns on the list view', q(BAR) !== null)

// ══ 15. 卸载清理 ════════════════════════════════════════════════════════════
if (typeof teardown === 'function') teardown()
await settle()
rec('teardown removes the bar', q(BAR) === null)
rec('teardown removes the style tag', document.getElementById('dsh-plugin-list-search-style') === null)
rec('teardown leaves no hidden markers', hiddenCount() === 0, hiddenCount())

// ── 输出 ────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok)
for (const r of failed) {
  console.log(`FAIL  ${r.name}${r.detail === undefined ? '' : `\n      detail: ${r.detail}`}`)
}
console.log(`\n${results.length - failed.length}/${results.length} DOM checks passed`)
dom.window.close()
if (failed.length > 0) process.exit(1)
