import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// Reference dashboard for the Pera API. The production dashboard is a separate app; this page
// documents the browser side of the passkey flow with smart-account-kit.
export default defineConfig({
  plugins: [nodePolyfills({ include: ["buffer", "crypto", "stream", "util", "events"] })],
  server: { port: 5173 },
});
