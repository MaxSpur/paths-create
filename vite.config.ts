import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5198,
    strictPort: true
  },
  preview: {
    host: "127.0.0.1",
    port: 4198,
    strictPort: true
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts"
  }
});
