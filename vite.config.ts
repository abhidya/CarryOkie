import { defineConfig } from "vite";

const allowedHosts = ["abdulrehmans-macbook-pro.local"];

export default defineConfig({
  base: "./",
  preview: { host: "0.0.0.0", port: 4174, strictPort: true, allowedHosts },
  root: ".",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: "index.html",
        host: "host/index.html",
        player: "player/index.html",
        receiver: "receiver/index.html",
        debug: "debug/index.html",
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
  server: {
    port: 4174,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts,
  },
});
