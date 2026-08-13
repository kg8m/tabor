import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Tabor",
  version: "0.1.0",
  description: "Tree-style tab manager extension for Vivaldi",
  permissions: ["tabs", "storage", "sidePanel"],
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  action: {
    default_title: "Tabor",
  },
});
