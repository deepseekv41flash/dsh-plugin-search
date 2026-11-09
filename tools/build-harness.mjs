// Rebuild a faithful standalone copy of THIS machine's Plugins page and load this
// package's client bundle into it — the visual/behavioural check for a DSH upgrade.
//
// Why: the Plugins page is owned by @deepseek-ai/dsh-client-ui-plugin-manager, and its
// header layout has changed between shell generations (DSH NEXT 2.0.x measures the
// header and absolutely positions its parts). A jsdom fixture can encode yesterday's
// structure; this tool reads today's CSS and JSX attributes straight out of the
// installed app.asar, so drift shows up as a visible overlap instead of a surprise.
//
// Usage:
//   node tools/build-harness.mjs [--asar <path>] [--out <dir>] [--bundle <path>]
// Defaults: asar = %LOCALAPPDATA%/Programs/DSH NEXT/resources/app.asar
//           out  = .verify
//           bundle = ../lib/client.js (relative to the emitted page)
//
// Then open the emitted harness.html, run `__boot()`, and (optionally) `__natural()`
// to reproduce the shell's measure() pass. See README "开发与测试".
import { open, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const asarPath = opt('asar', join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DSH NEXT', 'resources', 'app.asar'))
const outDir = opt('out', '.verify')
const bundleRel = opt('bundle', '../lib/client.js')

// ── minimal asar reader (same layout as tools/asar-extract.mjs) ───────────────
async function readAsar(archivePath, wanted) {
  const fh = await open(archivePath, 'r')
  const sizeBuf = Buffer.alloc(8)
  await fh.read(sizeBuf, 0, 8, 0)
  const headerSize = sizeBuf.readUInt32LE(4)
  const raw = Buffer.alloc(headerSize)
  await fh.read(raw, 0, headerSize, 8)
  const start = raw.indexOf(0x7b)
  const declared = raw.readUInt32LE(start - 4)
  const jsonText = declared > 0 && start - 4 + declared <= raw.length
    ? raw.subarray(start, start + declared).toString('utf8')
    : raw.subarray(start).toString('utf8')
  const header = JSON.parse(jsonText)
  const baseOffset = 8 + headerSize
  const entries = []
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const path = prefix ? `${prefix}/${name}` : name
      if (child.files) walk(child, path)
      else if (child.offset !== undefined) entries.push({ path, offset: baseOffset + Number(child.offset), size: child.size ?? 0 })
    }
  }
  walk(header, '')
  const found = entries.find((e) => e.path === wanted)
  if (!found) throw new Error(`entry not found in asar: ${wanted}`)
  const buf = Buffer.alloc(found.size)
  await fh.read(buf, 0, found.size, found.offset)
  await fh.close()
  return buf.toString('utf8')
}

const UPM_CLIENT = 'node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js'
const clientSource = await readAsar(asarPath, UPM_CLIENT)

// ── the page's own CSS: shipped inline in the client bundle as `const css = "…"` ──
function extractCss(source) {
  const m = /const css = ("(?:[^"\\]|\\.)*")/u.exec(source)
  if (!m) throw new Error('page CSS literal not found — ui-plugin-manager changed its bundling')
  try {
    return JSON.parse(m[1])
  } catch {
    return m[1].slice(1, -1).replace(/\\(.)/gu, (_a, ch) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch))
  }
}
const css = extractCss(clientSource)

// ── read the structure contract out of the JSX so the harness cannot drift ─────
const cls = (suffix, required = true) => {
  const m = new RegExp(`\\.([A-Za-z0-9]+_${suffix})(?=[{,:\\s])`, 'u').exec(css)
  if (!m) {
    if (required) throw new Error(`class not found in page CSS: ${suffix}`)
    return ''
  }
  return m[1]
}
const names = {
  page: cls('page'),
  pageBody: cls('pageBody'),
  pageBar: cls('pageBar'),
  pageHead: cls('pageHead'),
  pageHeading: cls('pageHeading'),
  pageTitle: cls('pageTitle'),
  pageIntro: cls('pageIntro'),
  toolbar: cls('toolbar'),
  updatesNote: cls('updatesNote'),
  addButton: cls('addButton'),
  toolbarLabel: cls('toolbarLabel'),
  pageTabs: cls('pageTabs'),
  group: cls('group'),
  groupHead: cls('groupHead'),
  groupTitle: cls('groupTitle'),
  cards: cls('cards'),
  card: cls('card'),
  cardLink: cls('cardLink'),
  cardHead: cls('cardHead', false),
  cardTitle: cls('cardTitle', false),
  cardDesc: cls('cardDesc', false),
}
// Group ids the page actually renders (`renderGroup("basic" | "extensions" | "bundles")`).
const groupIds = [...clientSource.matchAll(/renderGroup\("([a-z-]+)"/gu)].map((m) => m[1])

const GROUPS = [
  { id: groupIds[0] ?? 'basic', title: '基础', packages: [
    { name: '@deepseek-ai/dsh-basic-bundle', status: 'on', title: '基础能力', desc: '会话、文件、终端与常用工具。' },
  ] },
  { id: groupIds[1] ?? 'extensions', title: '扩展', packages: [
    { name: '@deepseek-ai/dsh-experimental-agent-team-bundle', status: 'off', title: '智能体团队', desc: '启用团队协作、团队工具、成员列表和共享任务看板。' },
    { name: '@deepseek-ai/dsh-experimental-schedule-bundle', status: 'off', title: '自动化任务', desc: '按设定的时间或周期，在会话中自动执行任务。' },
    { name: '@deepseek-ai/dsh-office-bundle', status: 'on', title: 'Office 文档', desc: '读写 Word、Excel、PPT 与 PDF。' },
  ] },
  { id: groupIds[2] ?? 'bundles', title: '已安装', packages: [
    { name: 'dsh-multi-shell', status: 'on', title: 'dsh-multi-shell', desc: '按 shell 参数逐次选择 gitbash / powershell / wsl。' },
    { name: 'dsh-speed-meter', status: 'on', title: 'dsh-speed-meter', desc: '显示模型输出速度与首字延迟。' },
    { name: 'dsh-browser-use', status: 'on', title: 'dsh-browser-use', desc: '真实 Chromium 的页面读取与交互工具。' },
    { name: 'dsh-workspace-mover', status: 'on', title: '工作区迁移', desc: '把会话搬到另一个工作区分组。' },
  ] },
]

const card = (p) => `
        <li class="${names.card} ${names.cardLink}" data-plugin-package="${p.name}" data-plugin-status="${p.status}">
          <div class="${names.cardHead}">
            <div>
              <h3 class="${names.cardTitle}">${p.title}</h3>
              <p class="${names.cardDesc}">${p.desc}</p>
            </div>
          </div>
        </li>`

const group = (g) => `
      <section class="${names.group}" data-plugin-scope="global" data-plugin-group="${g.id}">
        <div class="${names.groupHead}">
          <h3 class="${names.groupTitle}">${g.title}</h3>
        </div>
        <ul class="${names.cards}">${g.packages.map(card).join('')}
        </ul>
      </section>`

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Plugins page harness — ${UPM_CLIENT}</title>
<style>
  /* 主题 token 的最小替身：让外壳样式表里的 var() 有东西可取。 */
  :root {
    --dsw-alias-bg-base: #ffffff;
    --dsw-alias-bg-layer-1: #ffffff;
    --dsw-alias-bg-layer-2: #f6f6f7;
    --dsw-alias-bg-overlay: #ffffff;
    --dsw-alias-border-l1: #ebebec;
    --dsw-alias-border-l2: #dcdcde;
    --dsw-alias-border-l3: #e3e3e5;
    --dsw-alias-brand-primary: #3a7afe;
    --dsw-alias-state-business-primary: #3a7afe;
    --dsw-alias-label-primary: #17181a;
    --dsw-alias-label-secondary: #4b4d52;
    --dsw-alias-label-tertiary: #85878c;
    --dsw-alias-label-caption: #9a9ca1;
    --dsw-alias-label-dimmed: #b6b8bd;
    --dsw-radius-md: 8px;
    --dsw-specific-sidebar-fill: #f6f6f7;
  }
  html, body { margin: 0; height: 100%; background: var(--dsw-alias-bg-base);
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
  /* 外壳自己的页面 CSS，逐字节来自本次构建。 */
  ${css}
</style>
</head>
<body>
<main style="height:100%;overflow:hidden;display:flex">
  <aside style="width:232px;flex:none;background:var(--dsw-specific-sidebar-fill);border-right:0.5px solid var(--dsw-alias-border-l1);padding:16px 12px;box-sizing:border-box">
    <div style="font-weight:600;margin-bottom:12px">DeepSeek Harness</div>
    <div style="font-size:13px;color:var(--dsw-alias-label-secondary);line-height:28px">会话<br>文件<br><b>插件</b><br>自动化任务</div>
  </aside>
  <div style="flex:1;min-width:0;display:flex">
    <section class="${names.page}" data-plugin-panel aria-busy="false">
      <div class="${names.pageBody}" data-plugin-body>
        <div class="${names.pageBar}" data-plugin-bar>
          <header class="${names.pageHead}" data-plugin-page-header="list" data-window-drag>
            <div class="${names.pageHeading}">
              <h1 class="${names.pageTitle}" data-plugin-header-part="title">插件</h1>
              <div class="${names.pageIntro}" data-plugin-header-part="intro">
                <span>管理插件包：启用、停用、配置与安装。</span>
              </div>
            </div>
            <div class="${names.toolbar}" data-plugin-toolbar data-plugin-header-part="toolbar">
              <span class="${names.updatesNote}">全部为最新版本</span>
              <button class="${names.addButton}" type="button"><span class="${names.toolbarLabel}">刷新</span></button>
              <button class="${names.addButton}" type="button"><span class="${names.toolbarLabel}">添加插件</span></button>
            </div>
            <div class="${names.pageTabs}" data-plugin-header-part="tabs">
              <div style="display:inline-flex;gap:4px">
                <button type="button" style="font:inherit;padding:4px 10px;border-radius:6px;border:0;background:var(--dsw-alias-bg-layer-2)">已安装</button>
                <button type="button" style="font:inherit;padding:4px 10px;border-radius:6px;border:0;background:transparent;color:var(--dsw-alias-label-secondary)">发现</button>
              </div>
            </div>
          </header>
        </div>
${GROUPS.map(group).join('\n')}
      </div>
    </section>
  </div>
</main>
<script>
  /* 迷你 __ModuleLoader__：外壳调 factory 的方式一致。 */
  window.__ModuleLoader__ = { load(row) { window.__pluginRow = row } };
  window.__harnessErrors = [];
  window.addEventListener('error', (e) => window.__harnessErrors.push(String(e.message)));
</script>
<script src="${bundleRel}"></script>
<script>
  /** 启动被测 bundle：apply(ctx) 外面套一层 ctx.effect（与外壳一致）。 */
  window.__boot = function boot() {
    const row = window.__pluginRow;
    if (!row) throw new Error('client bundle did not register');
    const mod = row.factory();
    const disposers = [];
    mod.apply({
      effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
      locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe: () => () => {} },
    });
    window.__dispose = () => { for (const d of disposers.reverse()) d() };
    return true;
  };
  /**
   * 复刻 ui-plugin-manager 的 measure()：量出各 header part 的位置写进 CSS 变量，
   * 再给 [data-plugin-bar] 打上 data-natural。2.0.x 上挂载即执行，不是滚动才执行。
   */
  window.__natural = function natural() {
    const bar = document.querySelector('[data-plugin-bar]');
    const header = bar.querySelector('header');
    const h = header.getBoundingClientRect();
    for (const el of header.querySelectorAll('[data-plugin-header-part]')) {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--plugin-part-x', (r.x - h.x) + 'px');
      el.style.setProperty('--plugin-part-y', (r.y - h.y) + 'px');
      el.style.setProperty('--plugin-part-width', r.width + 'px');
    }
    bar.style.setProperty('--plugin-header-rest-height', h.height + 'px');
    bar.style.setProperty('--plugin-header-compact-height', '56px');
    bar.style.setProperty('--plugin-header-travel', '40px');
    document.querySelector('[data-plugin-body]').style.setProperty('--plugin-header-scroll-padding', '64px');
    bar.setAttribute('data-natural', '');
    return true;
  };
</script>
</body>
</html>`

await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, 'harness.html'), html)
await writeFile(join(outDir, 'shell.css'), css)
console.log(`wrote ${join(outDir, 'harness.html')} (${html.length} bytes)`)
console.log(`shell page CSS: ${css.length} bytes | groups: ${GROUPS.map((g) => g.id).join(', ')}`)
console.log(`bundle: ${bundleRel}`)
