/**
 * 插件列表搜索（plugin-list-search）——浏览器半（手写 bundle，零构建链）。
 *
 * ## 为什么是 DOM 注入
 *
 * 「插件」页由 @deepseek-ai/dsh-client-ui-plugin-manager 拥有。它对外声明的扩展位里
 * 没有「列表工具栏」——`main` 又是 keyed slot，"plugins" 这个 key 已被它自己占用，
 * 想走槽位只能整页顶替外壳 UI（升级即碎）。所以这里认页面自带的稳定 `data-*` 契约，
 * 把一条搜索条挂进去，按关键词切换卡片的显示。
 *
 * 依赖的 DOM 契约（全部是外壳 JSX 上写死的属性，不是哈希类名）：
 *
 *   [data-plugin-panel]                 页面根
 *   [data-plugin-body]                  滚动容器
 *   [data-plugin-bar]                   页头包裹层（natural 测量模式的宿主）
 *   [data-plugin-toolbar]               页头右侧工具条（「刷新 / 添加插件」那一行）
 *   [data-plugin-group]                 分组（basic / extensions / bundles）
 *   [data-plugin-package="<包名>"]       一个插件包卡片
 *   [data-plugin-item="<id>"]           一个官方插件卡片
 *
 * ## 与社区版 dsh-plugin-search 的差别（版本适配）
 *
 * DSH NEXT 2.0.x 的插件页头是「测量式」布局：挂载后 measure() 给
 * `[data-plugin-header-part]`（title/intro/toolbar/tabs）逐个写 `--plugin-part-*`，
 * 再把整块改成绝对定位，并把 `.pageHeading` 设成 `display: contents`。因此把搜索条
 * 塞进 pageHeading 的旧做法会与标题重叠（本机 2.0.22 上实测如此）。
 *
 * 这里改为两种安全落点，按可用性选择：
 *
 *   1. 工具条内（首选）：`[data-plugin-toolbar]` 本身就是一个被测量并定位的部件，
 *      往里加一个子元素只会让它变宽，永远不会和标题抢位置；而且工具条随页头粘住，
 *      滚动时搜索框一直在。
 *   2. 页头下方一行（退化）：没有工具条时，作为 `[data-plugin-body]` 的子节点插在
 *      页头包裹层之后 —— 也落在被绝对定位的部件之外。
 *
 * ## 边界
 *
 * 只读 DOM：只改「显示哪几张卡片」和挂一条搜索条，不碰数据、不发请求、不写会话、
 * 不动 Loader 的启停状态。搜索词为空时页面的 DOM 与外壳自己渲染的完全一致。
 *
 * 版式与交互思路参考 MIT 许可的 huangxp12/dsh-plugin-search（社区版），落点与
 * 版本适配为本机重写。
 */

window.__ModuleLoader__.load({
	id: "dsh-plugin-list-search",
	factory: () => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const NS = "dsh-plugin-list-search";
		const STYLE_ID = "dsh-plugin-list-search-style";
		/** 命中失败的元素标记（卡片与分组共用）。样式表里只有它一条 display:none。 */
		const HIDDEN_ATTR = "data-dsh-list-search-hidden";
		/** 搜索条自己的锚点，同步逻辑靠它认领自己创建的节点。 */
		const BAR_ATTR = "data-dsh-list-search";
		/**
		 * 重算的最小间隔（毫秒）。见 schedule()：把 body 级 mutation 洪水限速成固定
		 * 采样节奏，避免把外壳的测量-渲染链放大成 sync 风暴。
		 */
		const SYNC_INTERVAL_MS = 60;

		const SELECTORS = Object.freeze({
			panel: "[data-plugin-panel]",
			body: "[data-plugin-body]",
			pageBar: "[data-plugin-bar]",
			toolbar: "[data-plugin-toolbar]",
			card: "[data-plugin-package], [data-plugin-item]",
			group: "[data-plugin-group]",
			loading: "[data-plugin-loading]",
			idPackage: "data-plugin-package",
			idItem: "data-plugin-item",
		});

		/** 命中（未被我们藏起来）的卡片。分组是否该显示，看的就是组里还有没有它。 */
		const VISIBLE_CARD =
			`[${SELECTORS.idPackage}]:not([${HIDDEN_ATTR}]), `
			+ `[${SELECTORS.idItem}]:not([${HIDDEN_ATTR}])`;

		const DICT = {
			zh: {
				placeholder: "搜索插件…",
				label: "搜索插件",
				clear: "清除搜索",
				noResults: "没有匹配的插件",
				status: "{shown} / {total}",
			},
			en: {
				placeholder: "Search plugins…",
				label: "Search plugins",
				clear: "Clear search",
				noResults: "No matching plugins",
				status: "{shown} / {total}",
			},
		};

		// ── 纯函数（不碰 DOM） ───────────────────────────────────────────────

		/** 查询词 → 关键词数组：空白分隔、全小写、丢空串。多个关键词之间是 AND。 */
		function splitQuery(query) {
			return String(query ?? "")
				.toLowerCase()
				.split(/\s+/)
				.filter((term) => term.length > 0);
		}

		/** haystack 是否包含全部关键词（大小写不敏感的子串匹配）。空关键词表 = 全命中。 */
		function matchesQuery(haystack, terms) {
			const hay = String(haystack ?? "").toLowerCase();
			for (const term of terms) {
				if (!hay.includes(String(term ?? "").toLowerCase())) return false;
			}
			return true;
		}

		/**
		 * 当前语言：优先问 DSH 的 locale 服务（跟界面语言一致），退化到浏览器语言。
		 * 刻意不 register 命名空间：一条搜索框不值得把「文案注册成功」变成依赖。
		 */
		function resolveLang(ctx) {
			try {
				const active = ctx && ctx.locale && ctx.locale.getSnapshot
					? ctx.locale.getSnapshot().active
					: undefined;
				if (typeof active === "string" && active.length > 0) return active;
			} catch {
				/* 服务缺失或尚未就绪：往下退化。 */
			}
			try {
				if (typeof navigator !== "undefined" && navigator.language) return navigator.language;
			} catch {
				/* 无 navigator：继续退化。 */
			}
			return "en";
		}

		/** zh* 用中文，其余英文。 */
		function pickDict(lang) {
			return String(lang ?? "").toLowerCase().startsWith("zh") ? DICT.zh : DICT.en;
		}

		/** {name} 占位替换。 */
		function format(text, params) {
			let out = String(text);
			if (params !== undefined && params !== null) {
				for (const [key, value] of Object.entries(params)) {
					out = out.split(`{${key}}`).join(String(value));
				}
			}
			return out;
		}

		// ── 样式 ─────────────────────────────────────────────────────────────

		/**
		 * 颜色/圆角全部走外壳主题 token，明暗主题自动跟随，不写死色值；
		 * 取不到 token 时给退化值，缺失的 token 不会让整条声明失效。
		 */
		const CSS = `
[${BAR_ATTR}] {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
  -webkit-app-region: no-drag;
}
[${BAR_ATTR}] .dls-field {
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  flex: 0 1 240px;
  min-width: 120px;
  height: 30px;
  padding: 0 8px;
  border: 0.5px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-l1));
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-1);
}
[${BAR_ATTR}] .dls-field:focus-within {
  border-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary));
}
[${BAR_ATTR}] .dls-icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--dsw-alias-label-tertiary);
}
[${BAR_ATTR}] .dls-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
}
[${BAR_ATTR}] .dls-input::placeholder {
  color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary));
}
[${BAR_ATTR}] .dls-input::-webkit-search-cancel-button {
  display: none;
}
[${BAR_ATTR}] .dls-clear {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-caption);
  cursor: pointer;
}
[${BAR_ATTR}] .dls-clear:hover {
  color: var(--dsw-alias-label-primary);
}
[${BAR_ATTR}] .dls-clear[hidden] {
  display: none;
}
[${BAR_ATTR}] .dls-status {
  color: var(--dsw-alias-label-caption);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
[${HIDDEN_ATTR}] {
  display: none !important;
}
`;

		/**
		 * 确保样式表在文档里存在。
		 *
		 * 不在 apply() 里插一次了事：`<head>` 可能被外壳重建、插件可能被停用再启用，
		 * 而 apply() 早已跑过。每次同步顺手确认一次（getElementById 很便宜）。
		 */
		function ensureStyles() {
			if (typeof document === "undefined" || !document.head) return null;
			let tag = document.getElementById(STYLE_ID);
			if (!tag) {
				tag = document.createElement("style");
				tag.id = STYLE_ID;
				tag.textContent = CSS;
				document.head.appendChild(tag);
			} else if (tag.textContent !== CSS) {
				tag.textContent = CSS;
			}
			return tag;
		}

		/** 只在内容真的变了才写 textContent —— 重复赋同值会造出 mutation。 */
		function setText(el, text) {
			if (el && el.textContent !== text) el.textContent = text;
		}

		// ── 节点构造 ─────────────────────────────────────────────────────────

		/** 建立搜索条（自己建节点，不用 React —— 它不属于外壳的渲染树）。 */
		function buildBar(dict) {
			const bar = document.createElement("div");
			bar.setAttribute(BAR_ATTR, "");

			const field = document.createElement("div");
			field.className = "dls-field";

			const icon = document.createElement("span");
			icon.className = "dls-icon";
			icon.setAttribute("aria-hidden", "true");
			icon.innerHTML =
				'<svg viewBox="0 0 16 16" width="14" height="14" fill="none" '
				+ 'stroke="currentColor" stroke-width="1.4" stroke-linecap="round">'
				+ '<circle cx="7" cy="7" r="4.4"/><path d="M10.4 10.4 14 14"/></svg>';

			const input = document.createElement("input");
			input.className = "dls-input";
			input.type = "search";
			input.autocomplete = "off";
			input.spellcheck = false;
			input.setAttribute("enterkeyhint", "search");
			input.placeholder = dict.placeholder;
			input.setAttribute("aria-label", dict.label);

			const clear = document.createElement("button");
			clear.className = "dls-clear";
			clear.type = "button";
			clear.hidden = true;
			clear.setAttribute("aria-label", dict.clear);
			clear.innerHTML =
				'<svg viewBox="0 0 16 16" width="12" height="12" fill="none" '
				+ 'stroke="currentColor" stroke-width="1.5" stroke-linecap="round">'
				+ '<path d="M4 4 12 12M12 4 4 12"/></svg>';

			const status = document.createElement("span");
			status.className = "dls-status";
			status.setAttribute("role", "status");
			status.setAttribute("aria-live", "polite");

			field.appendChild(icon);
			field.appendChild(input);
			field.appendChild(clear);
			bar.appendChild(field);
			bar.appendChild(status);

			return { bar, input, clear, status };
		}

		/** 按当前语言刷新文案（切语言时调用，不重建节点 —— 用户输入不能丢）。 */
		function relabel(ui, dict) {
			ui.input.placeholder = dict.placeholder;
			ui.input.setAttribute("aria-label", dict.label);
			ui.clear.setAttribute("aria-label", dict.clear);
		}

		// ── 插件主体 ─────────────────────────────────────────────────────────

		function apply(ctx) {
			if (typeof document === "undefined" || !document.body) {
				console.warn(`[${NS}] 没有 document：本插件只在 Web GUI 里工作`);
				return;
			}

			ctx.effect(() => {
				const ui = buildBar(pickDict(resolveLang(ctx)));
				let dict = pickDict(resolveLang(ctx));
				/** 当前查询词。住在 fiber 里：卡片被 React 重挂后仍然有效。 */
				let query = "";
				let hidAnything = false;
				let disposed = false;
				let scheduled = false;
				/** 限速重算的定时器句柄（见 schedule）。 */
				let timer = null;
				let observer = null;

				// ── 同步：把搜索条放到该在的位置，并按关键词切换卡片显示 ──────

				/**
				 * 挑选落点。返回 null 表示现在不该有搜索条。
				 *
				 * 首选工具条：它本身就是被 measure() 定位的页头部件，往里加子元素只会
				 * 让它变宽，不存在与标题抢位置的可能。工具条在非「已安装」页签上是
				 * hidden 的，此时用退化落点：页头包裹层之后的一行。
				 *
				 * 锚点必须排除搜索条自己：一旦它成为锚点，`place()` 每轮都会
				 * `insertBefore(bar, bar)` —— 持续产生 childList mutation，喂回观察者
				 * 形成自激循环（实测会把页面卡死）。两个分支都要防。
				 */
				function findSlot(panel) {
					const toolbar = panel.querySelector(SELECTORS.toolbar);
					if (toolbar && !toolbar.hasAttribute("hidden")) {
						let before = toolbar.firstElementChild;
						if (before === ui.bar) before = ui.bar.nextElementSibling;
						return { parent: toolbar, before, mode: "toolbar" };
					}
					const body = panel.querySelector(SELECTORS.body);
					const pageBar = panel.querySelector(SELECTORS.pageBar);
					if (body && pageBar && pageBar.parentNode === body) {
						let before = pageBar.nextSibling;
						while (before !== null && before === ui.bar) before = before.nextSibling;
						return { parent: body, before, mode: "row" };
					}
					return null;
				}

				/** 把搜索条挪到落点。移动会打断焦点，所以自己保存/恢复焦点与光标位置。 */
				function place(slot) {
					// 防御：锚点永远不能是自己 —— 否则 insertBefore(bar, bar) 会持续产生
					// mutation 并喂回观察者，形成自激循环。
					if (slot.before === ui.bar) return;
					const current = ui.bar.parentNode;
					if (current === slot.parent) {
						// 已经在落点上：用 nextElementSibling 比较，跨文本节点也成立。
						if (ui.bar.nextElementSibling === slot.before) return;
						if (slot.before === null && ui.bar === slot.parent.lastElementChild) return;
					}
					const focused = document.activeElement === ui.input;
					const start = focused ? ui.input.selectionStart : null;
					const end = focused ? ui.input.selectionEnd : null;
					slot.parent.insertBefore(ui.bar, slot.before);
					if (focused) {
						try {
							ui.input.focus({ preventScroll: true });
							if (typeof ui.input.setSelectionRange === "function"
								&& start !== null && end !== null) {
								ui.input.setSelectionRange(start, end);
							}
						} catch {
							/* 焦点恢复失败不影响过滤本身。 */
						}
					}
				}

				/** 摘掉搜索条，并清掉所有隐藏标记（把 DOM 还给外壳原样）。 */
				function detach() {
					if (ui.bar.parentNode) ui.bar.parentNode.removeChild(ui.bar);
					if (hidAnything) resetVisibility();
				}

				function resetVisibility() {
					for (const node of document.querySelectorAll(`[${HIDDEN_ATTR}]`)) {
						node.removeAttribute(HIDDEN_ATTR);
					}
					hidAnything = false;
				}

				function sync() {
					if (disposed) return;

					// 快速退出：观察的是整个 document.body，会话流式输出时 mutation 不断。
					const panels = document.querySelectorAll(SELECTORS.panel);
					if (panels.length === 0) {
						detach();
						return;
					}

					ensureStyles();

					// 多个面板同时在场的理论情况：挑有卡片或在加载的那个。
					let panel = null;
					for (const candidate of panels) {
						if (candidate.querySelector(`${SELECTORS.card}, ${SELECTORS.loading}`)) {
							panel = candidate;
							break;
						}
					}
					if (panel === null) panel = panels[0];

					const cards = panel.querySelectorAll(SELECTORS.card);
					const loading = panel.querySelector(SELECTORS.loading) !== null;
					// 没有卡片可搜、也不在加载中（不可用 / 出错 / 空列表）：不摆搜索框。
					if (cards.length === 0 && !loading) {
						detach();
						return;
					}

					const slot = findSlot(panel);
					if (slot === null) {
						detach();
						return;
					}
					place(slot);

					const terms = splitQuery(query);
					let shown = 0;
					let hidden = 0;
					for (const card of cards) {
						const id = card.getAttribute(SELECTORS.idPackage)
							?? card.getAttribute(SELECTORS.idItem)
							?? "";
						// 命中范围 = 卡片上看得见的全部文字 + 包名/id
						// （后者多半不显示，但「按包名找插件」是很自然的用法）。
						const hit = terms.length === 0
							|| matchesQuery(`${card.textContent ?? ""} ${id}`, terms);
						if (hit) {
							if (card.hasAttribute(HIDDEN_ATTR)) card.removeAttribute(HIDDEN_ATTR);
							shown++;
						} else {
							if (!card.hasAttribute(HIDDEN_ATTR)) card.setAttribute(HIDDEN_ATTR, "");
							hidden++;
						}
					}
					hidAnything = hidden > 0;

					// 整组都没有可见卡片时，连组标题一起藏掉 —— 不留「基础 0」这种空壳。
					// 判据必须是「组里还有没有可见卡片」：一个组里既有命中也有不命中是常态。
					for (const group of panel.querySelectorAll(SELECTORS.group)) {
						const empty = terms.length > 0 && group.querySelector(VISIBLE_CARD) === null;
						if (empty) group.setAttribute(HIDDEN_ATTR, "");
						else group.removeAttribute(HIDDEN_ATTR);
					}

					// 自己报数，不去改外壳的计数文本节点（那是 React 管的）。
					if (terms.length === 0 || cards.length === 0) {
						setText(ui.status, "");
					} else if (shown === 0) {
						setText(ui.status, dict.noResults);
					} else {
						setText(ui.status, format(dict.status, { shown, total: cards.length }));
					}

					ui.clear.hidden = query.length === 0;
				}

				/**
				 * 合并一串 mutation 后重算。
				 *
				 * 刻意**不用** queueMicrotask：观察的是整个 document.body，而外壳挂载
				 * 「插件」页时本身会连发一大批 childList mutation；每一批都同步做一次
				 * 布局写入（插入/摘除搜索条、藏卡）会把外壳的测量-渲染链再顶起来一次，
				 * 于是 mutation → sync → 布局 → 更多 mutation 形成放大回路 —— 实测在
				 * dsh web 上打开「插件」页会把渲染线程卡死（1 秒内 400+ 次 sync）。
				 *
				 * 用定时器把重算限速到每 60ms 一次：外壳抖动再密，我们也只按固定节奏
				 * 采样一次当前 DOM。对照实验里同样的代码换成低频轮询即可正常工作。
				 */
				function schedule() {
					if (scheduled || disposed) return;
					scheduled = true;
					timer = setTimeout(() => {
						timer = null;
						scheduled = false;
						sync();
					}, SYNC_INTERVAL_MS);
				}

				// ── 事件 ────────────────────────────────────────────────────────

				ui.input.addEventListener("input", () => {
					query = ui.input.value;
					sync();
				});

				ui.input.addEventListener("keydown", (event) => {
					if (event.key !== "Escape" || query.length === 0) return;
					// 自己消费掉 Esc（清空搜索），别让它冒泡去关掉外壳的面板。
					event.stopPropagation();
					query = "";
					ui.input.value = "";
					sync();
				});

				ui.clear.addEventListener("click", () => {
					query = "";
					ui.input.value = "";
					sync();
					try {
						ui.input.focus({ preventScroll: true });
					} catch {
						/* 聚焦失败无所谓。 */
					}
				});

				// ── 起搏 ────────────────────────────────────────────────────────

				ensureStyles();
				sync();

				// 外壳的列表是 React 渲染的：加载完成、切页签/详情、装卸插件都会重挂卡片。
				// 观察 body 而不是面板本身 —— 面板自己也会被卸载重建（切走再切回来）。
				observer = new MutationObserver(schedule);
				observer.observe(document.body, { childList: true, subtree: true, characterData: true });

				// 语言切换：只换文案，不动输入。
				let unsubscribeLocale = () => {};
				try {
					if (ctx.locale && typeof ctx.locale.subscribe === "function") {
						unsubscribeLocale = ctx.locale.subscribe(() => {
							dict = pickDict(resolveLang(ctx));
							relabel(ui, dict);
							schedule();
						});
					}
				} catch {
					/* 没有 locale 服务：文案停在启动时那一份，不影响搜索。 */
				}

				return () => {
					disposed = true;
					if (timer !== null) clearTimeout(timer);
					timer = null;
					if (observer) observer.disconnect();
					try {
						unsubscribeLocale();
					} catch {
						/* 退订失败不该挡住后面的清理。 */
					}
					detach();
					const tag = document.getElementById(STYLE_ID);
					if (tag) tag.remove();
				};
			}, `${NS}: plugins page filter`);
		}

		exports.NS = NS;
		exports.apply = apply;
		/** cordis 服务注入：声明了它，ctx.locale 才在 apply 里可用。 */
		exports.inject = ["locale"];
		/** 纯函数与选择器，供单元测试直接引用（不含 DOM 副作用）。 */
		exports.__internals = {
			CSS,
			DICT,
			SELECTORS,
			format,
			matchesQuery,
			pickDict,
			resolveLang,
			splitQuery,
		};
		return module.exports;
	},
});
