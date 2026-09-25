import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths, so the build works wherever it's hosted (GitHub
  // Pages serves it under /filmic/).
  base: "./",
  plugins: [react()],
});
