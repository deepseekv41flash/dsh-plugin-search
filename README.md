# dsh-plugin-list-search

给 DeepSeek Harness 的**「插件」页**加一条关键词搜索框：装了几十个插件时，按标题、描述或包名一筛就找到了。


这是 [huangxp12/dsh-plugin-search](https://github.com/huangxp12/dsh-plugin-search) 的 **DSH NEXT 2.0.x 适配 fork**。上游的做法在 2.0.x 的测量式页头上会把搜索框压到标题上（见下），本 fork 换成两个安全落点，其余行为（匹配规则、计数、清空、抗重挂）保持不变。

## 它做什么

在「插件」页（侧栏 **插件**）页头注入一条搜索条，边输入边过滤卡片：

- **命中范围**：卡片上看得见的全部文字（标题、描述、状态标签）+ `data-plugin-package` / `data-plugin-item` 里的包名或注册 id。
- **匹配规则**：大小写不敏感的子串匹配；空格分隔的多个关键词之间是 **AND**（输入 `taskboard 看板` 要两个都命中）。
- **整组隐藏**：某个分组一张卡都没命中时，连组标题一起藏掉 —— 不留「基础 0」这种空壳。
- **计数**：搜索条右侧显示 `命中 / 总数`；一张都没命中时显示「没有匹配的插件」。
- **清空**：右侧的 × 或 `Esc` 清空（`Esc` 会被就地消费，不会冒泡去关掉外壳的面板）。
- **跟随语言**：中文界面用中文文案，其余用英文。

## 为什么需要这个 fork

DSH NEXT 2.0.x 的插件页头是**测量式**布局：`PluginManagerPage` 挂载后 `measure()` 会给每个 `[data-plugin-header-part]`（title / intro / toolbar / tabs）写入 `--plugin-part-x/-y/-width`，随即：

- 给包裹层 `[data-plugin-bar]` 打上 `data-natural`；
- 把 `.pageHeading` 设成 `display: contents`；
- 让页头各部件变成绝对定位，页头本身用 `--plugin-header-rest-height` + `clip-path` 固定高度。

上游把搜索条 append 进 `header.firstElementChild`（也就是 `.pageHeading`）的最后一个位置。在 2.0.x 上这会让搜索条脱离流式布局、贴在页头左上角，与绝对定位的标题**重叠**。本机实测（DSH NEXT 2.0.22 / 内核 0.2.2-rc.1，用外壳自己的 CSS 与 JSX 结构复现）：

```
titleRect  = { x: 274, y: 28, w: 234, h: 28 }
searchRect = { x: 274, y: 38, w: 212, h: 32 }   ← 与标题相交
```

## 落点策略（本 fork 的改动）

1. **优先 `[data-plugin-toolbar]` 内**（「刷新 / 添加插件」那一行）：工具条本身就是一个被 `measure()` 定位的页头部件，往里加子元素只会让它变宽，不可能与标题抢位置；页头粘住时搜索框也跟着在。
2. **退化到页头下方一行**：工具条不存在或被 `hidden`（非「已安装」页签）时，作为 `[data-plugin-body]` 的子节点插在 `[data-plugin-bar]` 之后 —— 同样落在被绝对定位的部件之外。

另外把「锚点排除自己」做成了硬约束：插入前如果锚点就是搜索条本身，`insertBefore(bar, bar)` 会持续产生 `childList` mutation 并喂回 `MutationObserver`，形成自激循环（实测会把渲染进程卡死）。两个落点分支都跳过自己，`place()` 里还有一道防御性 return，`test/dom.test.mjs` 用 `insertBefore` 计数守住这条。

## 安装

```bash
# npm（发布后用）
dsh plugin --profile desktop add dsh-plugin-list-search
```

`--profile` 是必需项；`desktop` 是 DSH NEXT 桌面壳的 profile 名（Web 版用 `web`）。装完**刷新页面**就生效 —— 前端插件不需要重启。

手动挂到已有 profile（例如 `~/.dsh/profiles/desktop`）：

1. 把本包放进 profile 的 `node_modules`（目录联接/junction 即可）：

   ```powershell
   New-Item -ItemType Junction `
     -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-plugin-list-search" `
     -Target "<本仓库路径>"
   ```

2. 在 profile 的 `cordis.patch.yml` 末尾追加：

   ```yaml
   - insert:
       - id: plugin-list-search
         name: 'dsh-plugin-list-search'
   ```

3. 重载页面（profile 开了 HMR 时，patch 文件本身被监听，通常不必重启）。

**回滚**：删掉那两行、再删掉 `node_modules\dsh-plugin-list-search` 这个 junction（或 `dsh plugin --profile desktop remove dsh-plugin-list-search`）。搜索词为空时页面的 DOM 与外壳自己渲染的完全一致，删掉插件不会留下任何标记。

## 它**不**做什么

只读 DOM 上的显示状态，不改数据：

- 不发任何网络请求，不读也不写会话日志；
- 不改 Loader 的启用状态，不装卸插件；
- 不动插件的配置；
- 搜索词为空时，页面的 DOM 与外壳自己渲染的完全一致（所有隐藏标记都会被摘掉）。

宿主半（`lib/index.js`）的 `apply()` 是空的：它存在的唯一意义是让本包在 Loader 树里成为一个**已启用的条目** —— 客户端 bundle 只对已启用的条目提供服务。

## 兼容性

| 外壳 | 状态 | 依据 |
| --- | --- | --- |
| DSH NEXT 2.0.22（内核 0.2.2-rc.1） | ✅ 实测 | 用本机 `app.asar` 里的 ui-plugin-manager CSS/JSX 复现页面结构，在真实 Chrome 里验证落位不重叠与过滤行为 |
| DSH NEXT 2.0.x 其他版本（有 `data-plugin-body` / `data-plugin-bar` / `data-plugin-toolbar`） | ✅ 预期可用 | 落点按属性探测，不依赖类名与版本号 |
| DSH 0.1.x / 没有测量式页头的旧外壳 | ⚠️ 未验证 | 会退化到第 2 落点（页头下方一行），功能不受影响，只是位置不同 |
| Web profile（`dsh web`） | ⚠️ 未验证 | 代码不依赖桌面壳 API，理论上一致 |

## 开发与测试

```bash
npm test          # unit（纯逻辑 + 加载契约）+ dom（jsdom 行为）
npm run check     # 两个 lib 文件的语法检查
```

- `test/unit.test.mjs` —— 关键词切分、匹配语义、语言文案、选择器契约、样式约束、宿主半空实现。
- `test/dom.test.mjs` —— 用与 2.0.22 真实渲染同构的夹具（`panel > body > bar > header > toolbar` + `basic/extensions/bundles` 三组、含 `data-plugin-item` 卡片）验证落位、过滤、分组隐藏、退化落点、React 重挂、详情页撤走、卸载清理，以及上面那条自激循环回归。

核对「本机外壳到底是什么结构」，以及升级后重新验证落位：

```bash
# 1) 只读地看外壳里写了什么契约
node tools/asar-extract.mjs "<DSH NEXT>/resources/app.asar" list plugin-manager
node tools/find-in-asar.mjs "<DSH NEXT>/resources/app.asar" "[data-plugin-panel]"

# 2) 用本次构建的 CSS / JSX 结构 + 本仓库的 bundle 生成一张可打开的「插件」页
node tools/build-harness.mjs                 # 读默认路径的 app.asar，产出 .verify/harness.html
#    浏览器打开 .verify/harness.html → 控制台 __boot() → __natural()（复刻 measure()）

# 3) 核对已发布包与运行中宿主
node tools/verify-installed.mjs "<某个含 node_modules 的目录>"
node tools/probe-host-realm.mjs "JSON.stringify(Object.keys(process.versions))"   # 宿主 realm 只读探针
```

`tools/build-harness.mjs` 直接从 `app.asar` 里取 ui-plugin-manager 的 CSS 与
`renderGroup()` 分组名，所以外壳改结构时它跟着变 —— 漂移会以「看得见的重叠」暴露，
而不是等用户发现搜索框跑到标题上。

## 许可

MIT。基于 [huangxp12/dsh-plugin-search](https://github.com/huangxp12/dsh-plugin-search)（MIT）改写，版式与交互思路来自上游，落点与 2.0.x 适配为本 fork 重写。
