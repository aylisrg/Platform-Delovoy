import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/postcss";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
export default defineConfig({
  root: import.meta.dirname,
  server: { host: "127.0.0.1", port: 4179, strictPort: true },
  esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [tailwindcss()] } },
  resolve: { alias: [
    { find: "next/image", replacement: resolve(import.meta.dirname, "image.tsx") },
    { find: "next/link", replacement: resolve(import.meta.dirname, "link.tsx") },
    { find: "next-auth/react", replacement: resolve(import.meta.dirname, "session.ts") },
    { find: "@landing", replacement: resolve(root, "landing-delovoy-park.ru") },
    { find: "@", replacement: resolve(root, "src") },
  ] },
  define: { "process.env": {} },
});
