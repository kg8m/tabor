import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import manifest from "./manifest.config.ts";

export default defineConfig({
  // Explicit ports, not Vite's own default-port inference, for both the
  // background service worker's HMR client (@crxjs/vite-plugin reads
  // `server.port`/`server.hmr.port` to build its WebSocket URL) and the side
  // panel's own (Vite's core client falls back to `server.ws.port`). Left
  // unset, both ended up building a URL with no port at all, failing their
  // first connection attempt before falling back to a direct one—which
  // still worked, but reported as an extension error in the meantime.
  server: {
    port: 5173,
    hmr: {
      port: 5173,
    },
    ws: {
      port: 5173,
    },
  },
  plugins: [react(), crx({ manifest })],
});
