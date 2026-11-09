# dsh-plugin-list-search

Keyword search for the **Plugins** page of DeepSeek Harness: with dozens of plugins installed, filter installed cards by title, description, or package name as you type.

This is a **DSH NEXT 2.0.x adaptation fork** of [huangxp12/dsh-plugin-search](https://github.com/huangxp12/dsh-plugin-search). The upstream placement overlaps the page title on 2.0.x's measured header; this fork uses two safe anchors and keeps every other behaviour (matching rules, counter, clearing, remount resilience) unchanged.

## What it does

It injects one search row into the Plugins page header and filters cards as you type:

- **Haystack**: all visible card text (title, description, status tag) plus the `data-plugin-package` / `data-plugin-item` value, so package names are searchable even when they are not rendered.
- **Matching**: case-insensitive substring matching. Space-separated terms are **AND**ed (`taskboard 看板` needs both).
- **Group hiding**: a group with no hit hides its heading too — no empty "Basic 0" shells.
- **Counter**: `shown / total` at the right of the search row; "No matching plugins" when nothing hits.
- **Clearing**: the × button or `Esc`. `Esc` is consumed in place so it does not close the shell's panel.
- **Locale**: Chinese UI gets Chinese copy, everything else English.

## Why this fork exists

In DSH NEXT 2.0.x the plugin page header is **measured**: after mount, `measure()` writes `--plugin-part-x/-y/-width` for every `[data-plugin-header-part]` (title / intro / toolbar / tabs), then:

- `[data-plugin-bar]` gets `data-natural`;
- `.pageHeading` becomes `display: contents`;
- header parts become absolutely positioned while the header keeps a fixed `--plugin-header-rest-height` plus a `clip-path`.

Upstream appends the search row into `header.firstElementChild` (`.pageHeading`). On 2.0.x that takes the row out of the measured flow and pins it to the header's top-left corner, directly **over the title**. Measured on DSH NEXT 2.0.22 / kernel 0.2.2-rc.1, reproducing the shell's own CSS and JSX structure:

```
titleRect  = { x: 274, y: 28, w: 234, h: 28 }
searchRect = { x: 274, y: 38, w: 212, h: 32 }   # intersects the title
```

## Placement strategy

1. **Inside `[data-plugin-toolbar]`** (the "Refresh / Add plugin" row) when it exists and is visible. The toolbar is itself a measured, positioned header part, so adding a child can only widen it — never fight the title for space — and it stays visible while the sticky header is on screen.
2. **A row under the header** as a fallback: appended to `[data-plugin-body]` right after `[data-plugin-bar]` when the toolbar is missing or `hidden` (other tabs).

Both branches also refuse to treat the search row itself as the insertion anchor: `insertBefore(bar, bar)` would keep emitting `childList` mutations back into the `MutationObserver` and spin the renderer (observed as a hang). The guard lives in `findSlot()`, with a defensive return in `place()`, and `test/dom.test.mjs` pins it with an `insertBefore` counter.

## Install

```bash
dsh plugin --profile desktop add dsh-plugin-list-search
```

`--profile` is required; `desktop` is the DSH NEXT desktop shell profile (use `web` for the web profile). Refresh the page afterwards — client plugins need no restart.

Manual mount into an existing profile (e.g. `~/.dsh/profiles/desktop`):

1. Put this package in the profile's `node_modules` (a junction is fine on Windows).
2. Append to the profile's `cordis.patch.yml`:

   ```yaml
   - insert:
       - id: plugin-list-search
         name: 'dsh-plugin-list-search'
   ```

3. Reload the page.

**Rollback**: remove those two lines and the junction (`dsh plugin --profile desktop remove dsh-plugin-list-search`). With an empty query the page DOM is exactly what the shell renders, so nothing is left behind.

## What it does NOT do

It only changes display state in the DOM:

- no network requests, no session log reads or writes;
- no Loader enable/disable, no install or uninstall;
- no plugin configuration changes.

The host half (`lib/index.js`) has an empty `apply()`: it exists only so the package is an enabled Loader entry, which is what makes the client bundle available.

## Compatibility

| Shell | Status | Evidence |
| --- | --- | --- |
| DSH NEXT 2.0.22 desktop shell (kernel 0.2.2-rc.1, ui-plugin-manager 0.2.2-rc.1) | ✅ measured | Page structure and CSS taken from the local `app.asar`, verified in real Chrome |
| `dsh web` 0.2.2-rc.1 (browser) | ✅ measured | Live `dsh --profile web` host: 13 cards / 3 groups, `pet` -> `1 / 13`, `dsh` -> `8 / 13`, no hit -> "No matching plugins", `Esc` clears |
| Other DSH NEXT 2.0.x builds exposing `data-plugin-body` / `data-plugin-bar` / `data-plugin-toolbar` | ✅ expected | Anchors are attribute-based, not class- or version-based |
| DSH 0.1.x / older shells without the measured header | ⚠️ untested | Falls back to a row under the header; filtering is unaffected |

## 0.1.1: why the resync is rate-limited

0.1.0 coalesced resyncs with `queueMicrotask`, so every mutation on `document.body` turned into an immediate `sync()` that itself writes layout (inserting the row, hiding cards). While the shell mounts the Plugins page it emits a burst of React mutations, and the two fed each other:

```
shell churn -> mutation -> our sync -> layout writes -> shell re-render -> more mutations -> ...
```

On `dsh --profile web` (0.2.2-rc.1) that froze the renderer when opening the Plugins page: a probe counted 400+ syncs in about a second, while the same page **without the plugin** produced zero mutations per second. Replacing the observer with a 250 ms poll made the same code behave, so `schedule()` now samples with `setTimeout(..., 60ms)`. `test/dom.test.mjs` waits in 60 ms steps and pins the stable-anchor invariant with an `insertBefore` counter.

## Development

```bash
npm test          # unit (pure logic + load contract) + dom (jsdom behaviour)
npm run check     # syntax check both lib files
```

Read-only helpers for checking what the local shell actually renders:

```bash
node tools/asar-extract.mjs "<DSH NEXT>/resources/app.asar" list plugin-manager
node tools/find-in-asar.mjs "<DSH NEXT>/resources/app.asar" "[data-plugin-panel]"
```

## License

MIT. Derived from [huangxp12/dsh-plugin-search](https://github.com/huangxp12/dsh-plugin-search) (MIT): layout and interaction design come from upstream, placement and the 2.0.x adaptation are rewritten here.
