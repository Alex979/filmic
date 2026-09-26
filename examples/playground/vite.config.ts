import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      input: {
        main: page("./index.html"),
        // The ink stress test (see src/stress.ts).
        stress: page("./stress.html"),
      },
    },
  },
});
