import path from "path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves this project from /Helio-Drift/, not the domain root.
  base: "/Helio-Drift/",
  define: {
    __APP_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version,
    ),
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/multiplayer-api": {
        target: "http://127.0.0.1:8788",
        rewrite: (path) => path.replace(/^\/multiplayer-api/, "/api"),
        ws: true,
      },
    },
  },
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
