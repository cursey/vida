import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/renderer"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/renderer/test-utils/setup.ts"],
    include: ["src/renderer/**/*.test.ts", "src/renderer/**/*.test.tsx"],
  },
});
