import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "./",
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../../shared"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, "."), path.resolve(__dirname, "../../shared")],
    },
  },
});
