import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/renderer"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/renderer/test/setup.ts"],
    include: ["src/renderer/**/*.test.ts", "src/renderer/**/*.test.tsx"],
  },
});
