# Tabor

A tree-style tab manager extension for Chrome and Vivaldi. The name blends "Tab" and "Arbor": every tab is shown in a
side panel as a node in a tree, tracking parent/child relationships between tabs.

Chrome and Vivaldi are the only officially supported browsers, but it may also work on other Chromium-based browsers
(Edge, Brave, Opera, etc.) since it only relies on standard Manifest V3 APIs.

## Features

- Side panel tree view of every tab in the window, with favicon, title, loading/suspended/audio-playing state, and
  suspend/close buttons per row; hovering a row shows its full title, URL, and note in a tooltip
- A tab opened from another tab (link or otherwise) becomes that tab’s child; closing a tab promotes its children to its
  own position
- Closing the active tab focuses a tree-aware next tab (nearest surviving descendant, then sibling, then ancestor)
  instead of the browser’s default neighbor
- Pinned tabs are shown in their own section above the tree, reorderable by drag-and-drop
- Drag-and-drop reordering and reparenting, including multi-select (`Ctrl`/`Cmd`-click, `Shift`-click; `Escape` clears
  the selection)
- Collapse/expand per node
- A right-click context menu for the targeted tab(s): reload, suspend (`chrome.tabs.discard`) the tab/its tree/every
  other tab, close the tab/its tree, pin/unpin, add/edit a note, and move tab(s)/tree(s) to another window
- A free-text note per tab, shown in its row
- The tree’s order stays in sync with the native tab bar in both directions
- Tree state persists across browser restarts (tabs and windows are re-matched by URL, since their ids change) and is
  periodically backed up, with a history view to preview and restore an earlier snapshot
- A “Closed windows” view listing the trees saved for windows that aren’t currently open, to preview or remove them by
  hand
- Incognito windows get their own tree too, but it’s discarded as soon as the window closes and never backed up
- Light/dark theme following the OS’s `prefers-color-scheme`

## Limitations

- Native tab groups (Chrome) and tab stacks (Vivaldi) aren’t supported. Tabor doesn’t account for them when syncing its
  tree’s order with the native tab bar, so using them together may break a group/stack or scramble the tree.

## Install

Requires Chrome 130+ (or a Vivaldi version based on it) and Node.js 26.

1. `npm install`
2. `npm run build`
3. Open `chrome://extensions` (Vivaldi: `vivaldi://extensions`), enable Developer mode, and load the `dist/` directory
   as an unpacked extension

## Development

- `npm run dev` — Vite dev server with HMR. Load `dist/` once as an unpacked extension (per Install above) while this
  keeps running, and both the side panel and the background service worker pick up source changes without a manual
  reload
- `npm run build` — type check, then production build into `dist/`
- `npm run typecheck` — TypeScript type checking
- `npm run lint` / `npm run format` — ESLint / Prettier
- `npm test` — Vitest (tree/sync logic only; UI components are untested)
