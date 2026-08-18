# Tabor

A tree-style tab manager extension for Chrome and Vivaldi. The name blends "Tab" and "Arbor": every tab is shown in a
side panel as a node in a tree, tracking parent/child relationships between tabs.

Chrome and Vivaldi are the only officially supported browsers, but it may also work on other Chromium-based browsers
(Edge, Brave, Opera, etc.) since it only relies on standard Manifest V3 APIs.

## Features

- Side panel tree view of every tab in the window, with favicon, title, loading/suspended state, and a close button per
  row
- A tab opened from another tab (link or otherwise) becomes that tab’s child; closing a tab promotes its children to its
  own position
- Pinned tabs are shown separately, independent of the tree
- Drag-and-drop reordering and reparenting, including multi-select (`Ctrl`/`Cmd`-click, `Shift`-click)
- Collapse/expand per node
- Manual tab suspension (`chrome.tabs.discard`)
- The tree’s order stays in sync with the native tab bar in both directions
- Tree state persists across restarts and is periodically backed up, with a history panel to preview and restore an
  earlier snapshot

## Install

1. `npm install`
2. `npm run build`
3. Open `chrome://extensions` (Vivaldi: `vivaldi://extensions`), enable Developer mode, and load the `dist/` directory
   as an unpacked extension

## Development

- `npm run dev` — Vite dev server with HMR. Load `dist/` once as an unpacked extension (per Install above) while this
  keeps running, and both the side panel and the background service worker pick up source changes without a manual
  reload
- `npm run build` — production build into `dist/`
- `npm run typecheck` — TypeScript type checking
- `npm run lint` / `npm run format` — ESLint / Prettier
- `npm test` — Vitest (tree/sync logic only; UI components are untested)
