import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "API_PORT");
  const apiPortValue = env.API_PORT?.trim() || "4310";
  const apiPort = Number(apiPortValue);
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65_535) {
    throw new Error("API_PORT must be an integer between 1 and 65535.");
  }

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist/client",
      emptyOutDir: true,
    },
  };
});
