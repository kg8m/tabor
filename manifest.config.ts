import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Tabor",
  version: "0.1.0",
  description: "Tree-style tab manager extension for Chrome and Vivaldi",
  // `chrome.storage.local.getKeys()` needs Chrome 130.
  minimum_chrome_version: "130",
  permissions: [
    "tabs",
    "storage",
    "sidePanel",
    "unlimitedStorage",
    "alarms",
    // For `getCachedFaviconUrl`’s `_favicon` API.
    "favicon",
  ],
  icons: {
    16: "icons/icon16.png",
    32: "icons/icon32.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  action: {
    default_title: "Tabor",
    default_icon: {
      16: "icons/icon16.png",
      32: "icons/icon32.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png",
    },
  },
});
