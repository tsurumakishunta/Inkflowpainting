import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "Inkflowpainting";

export default defineConfig({
  base: `/${repositoryName}/`,
  root: "github-pages",
  publicDir: false,
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  build: {
    outDir: "../pages-dist",
    emptyOutDir: true,
  },
});
