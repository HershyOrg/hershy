import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scwOnboardingProxyTarget =
  process.env.VITE_SCW_ONBOARDING_PROXY_TARGET?.trim() ||
  "http://127.0.0.1:18081";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/yahoo-finance": {
        target: "https://query1.finance.yahoo.com",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/yahoo-finance/, ""),
      },
      "/binance-spot": {
        target: "https://api.binance.com",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/binance-spot/, ""),
      },
      "/binance-futures": {
        target: "https://fapi.binance.com",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/binance-futures/, ""),
      },
      "/scw-onboarding-api": {
        target: scwOnboardingProxyTarget,
        changeOrigin: true,
        rewrite: (requestPath) =>
          requestPath.replace(/^\/scw-onboarding-api/, "") || "/",
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
