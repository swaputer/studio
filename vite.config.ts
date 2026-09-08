import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "buffer": fileURLToPath(new URL("./node_modules/buffer/index.js", import.meta.url)),
      "node:crypto": fileURLToPath(new URL("./src/lib/nodeCryptoShim.ts", import.meta.url))
    }
  },
  server: { host: "127.0.0.1", port: 4176 },
  preview: { host: "127.0.0.1", port: 4176 }
});
