import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" = radi na GitHub Pages podputanji i na bilo kojem statičkom hostu.
export default defineConfig({ base: "./", plugins: [react()], build: { outDir: "dist", sourcemap: false } });
