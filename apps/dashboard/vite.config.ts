import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// The product frontend: landing page (/) + passkey onboarding and dashboard (/app).
// Node polyfills are only needed by smart-account-kit / stellar-sdk (passkey-signed cap change).
export default defineConfig({
  plugins: [react(), tailwindcss(), nodePolyfills({ include: ["buffer", "crypto", "stream", "util", "events"] })],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: { port: 5174 },
});
