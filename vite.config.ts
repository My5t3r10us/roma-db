import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  build: { outDir: "web-dist" },
  server: {
    watch: {
      ignored: [
        "**/artifacts/**",
        "**/.build/**",
        "**/dist/**",
        "**/companion/**",
      ],
    },
  },
});
