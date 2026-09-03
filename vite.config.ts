import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from a project page, so assets resolve under /hackboard/ in production and / in dev.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/hackboard/" : "/",
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false },
}));
