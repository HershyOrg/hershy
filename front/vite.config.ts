import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scwOnboardingProxyTarget =
  process.env.VITE_SCW_ONBOARDING_PROXY_TARGET?.trim() ||
  "http://127.0.0.1:18081";
const localWalletPath = path.resolve(__dirname, ".local/evm-wallet.json");
const localWalletDisplayPath = "front/.local/evm-wallet.json";

type LocalWalletFile = {
  address: string;
  privateKey: string;
  updatedAt: string;
};

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        reject(new Error("request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function normalizeAddress(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) {
    throw new Error("EOA address must be a 0x-prefixed 20-byte hex address");
  }
  return text;
}

function normalizePrivateKey(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  const normalized = text.startsWith("0x") ? text : `0x${text}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("private key must be a 0x-prefixed 32-byte hex string");
  }
  return normalized;
}

function redactWallet(file: LocalWalletFile) {
  return {
    exists: true,
    address: file.address,
    privateKeyLast4: file.privateKey.slice(-4),
    updatedAt: file.updatedAt,
    storageLabel: localWalletDisplayPath,
  };
}

async function readLocalWallet() {
  try {
    const raw = await fs.readFile(localWalletPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalWalletFile>;
    if (!parsed.address || !parsed.privateKey || !parsed.updatedAt) return null;
    return parsed as LocalWalletFile;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error
      ? (error as { code?: string }).code
      : "";
    if (code === "ENOENT") return null;
    throw error;
  }
}

function localWalletPlugin(): Plugin {
  return {
    name: "local-wallet-json-api",
    configureServer(server) {
      server.middlewares.use("/local-wallet-api/wallet", async (request, response) => {
        try {
          if (request.method === "GET") {
            const wallet = await readLocalWallet();
            sendJson(response, 200, wallet ? redactWallet(wallet) : {
              exists: false,
              storageLabel: localWalletDisplayPath,
            });
            return;
          }

          if (request.method === "POST") {
            const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
            const wallet: LocalWalletFile = {
              address: normalizeAddress(body.address),
              privateKey: normalizePrivateKey(body.privateKey),
              updatedAt: new Date().toISOString(),
            };
            await fs.mkdir(path.dirname(localWalletPath), { recursive: true });
            await fs.writeFile(localWalletPath, `${JSON.stringify(wallet, null, 2)}\n`, {
              encoding: "utf8",
              mode: 0o600,
            });
            sendJson(response, 200, redactWallet(wallet));
            return;
          }

          if (request.method === "DELETE") {
            await fs.rm(localWalletPath, { force: true });
            sendJson(response, 200, {
              exists: false,
              storageLabel: localWalletDisplayPath,
            });
            return;
          }

          response.statusCode = 405;
          response.setHeader("Allow", "GET, POST, DELETE");
          response.end();
        } catch (error) {
          sendJson(response, 400, {
            error: error instanceof Error ? error.message : "local wallet request failed",
          });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localWalletPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    proxy: {
      "/scw-onboarding-api": {
        target: scwOnboardingProxyTarget,
        changeOrigin: true,
        rewrite: (requestPath) =>
          requestPath.replace(/^\/scw-onboarding-api/, "") || "/",
      },
    },
  },
});
