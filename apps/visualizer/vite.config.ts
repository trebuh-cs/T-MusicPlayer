import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../../shared"),
    },
  },
  server: {
    port: 1422,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, "."), path.resolve(__dirname, "../../shared")],
    },
  },
});
