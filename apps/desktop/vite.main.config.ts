import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: {
        main: "src/main.ts",
        preload: "src/preload.ts",
      },
      formats: ["cjs"],
    },
    outDir: "dist",
    rollupOptions: {
      external: ["electron"],
    },
  },
});
