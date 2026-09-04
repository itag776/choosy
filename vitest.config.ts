import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
  test: {
    environment: "node",
    restoreMocks: true,
    exclude: ["tests/e2e/**", "node_modules/**"],
  },
});
