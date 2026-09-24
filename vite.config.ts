import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  // Discover lazy worker codecs before a session starts; late optimization reloads lose pilot results.
  optimizeDeps: { include: ["jszip", "apache-arrow", "parquet-wasm/esm", "hyparquet", "hyparquet-compressors", "hyparquet/src/convert.js"] },
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
