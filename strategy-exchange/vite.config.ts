import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import {
  browseFilters,
  connectedExchanges,
  productTypes,
} from "./src/features/strategy-exchange/store/strategyCatalog";
import type { BrowseFilter, ProductType } from "./src/features/strategy-exchange/types/strategyTypes";
import {
  selectStrategyFeed,
  type StrategyFeedRequest,
  type StrategyFeedResponse,
} from "./src/features/strategy-exchange/api/strategyApi";
import {
  buildUserByAddressSql,
  buildVaultByAddressSql,
  buildVaultDiscussionSql,
  buildVaultByStrategyIdSql,
  selectDiscussionMessagesByVaultAddress,
  selectUserAccountByAddress,
  selectVaultByAddress,
  selectVaultByStrategyId,
  type VaultDiscussionResponse,
  type UserAccountResponse,
  type StrategyVaultResponse,
} from "./demoDB";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const nodeModulesPath = path.resolve(__dirname, "node_modules");
const linkedDependencies = [
  "@hookform/resolvers",
  "@monaco-editor/react",
  "@radix-ui/react-accordion",
  "@radix-ui/react-alert-dialog",
  "@radix-ui/react-aspect-ratio",
  "@radix-ui/react-avatar",
  "@radix-ui/react-checkbox",
  "@radix-ui/react-collapsible",
  "@radix-ui/react-context-menu",
  "@radix-ui/react-dialog",
  "@radix-ui/react-dropdown-menu",
  "@radix-ui/react-hover-card",
  "@radix-ui/react-label",
  "@radix-ui/react-menubar",
  "@radix-ui/react-navigation-menu",
  "@radix-ui/react-popover",
  "@radix-ui/react-progress",
  "@radix-ui/react-radio-group",
  "@radix-ui/react-scroll-area",
  "@radix-ui/react-select",
  "@radix-ui/react-separator",
  "@radix-ui/react-slider",
  "@radix-ui/react-slot",
  "@radix-ui/react-switch",
  "@radix-ui/react-tabs",
  "@radix-ui/react-toast",
  "@radix-ui/react-toggle",
  "@radix-ui/react-toggle-group",
  "@radix-ui/react-tooltip",
  "@xyflow/react",
  "class-variance-authority",
  "clsx",
  "cmdk",
  "dagre",
  "date-fns",
  "embla-carousel-react",
  "framer-motion",
  "input-otp",
  "lightweight-charts",
  "lucide-react",
  "react-day-picker",
  "react-hook-form",
  "react-resizable-panels",
  "recharts",
  "sonner",
  "tailwind-merge",
  "vaul",
  "viem",
  "zod",
];
const linkedDependencyAliases = Object.fromEntries(
  linkedDependencies.map((dependencyName) => [
    dependencyName,
    path.resolve(nodeModulesPath, dependencyName),
  ]),
);

const validBrowseFilters = new Set<string>(browseFilters);
const validTypes = new Set<string>(productTypes);

function parseStrategyFeedRequest(url: URL): StrategyFeedRequest {
  const categoryParam = url.searchParams.get("category") ?? "";
  const typeParam = url.searchParams.get("type") ?? "";
  const connectedVenues = url.searchParams.getAll("connected");

  return {
    category: validBrowseFilters.has(categoryParam) ? (categoryParam as BrowseFilter) : "Featured",
    type: validTypes.has(typeParam) ? (typeParam as "All" | ProductType) : "All",
    query: url.searchParams.get("q") ?? "",
    includeUnconnected: url.searchParams.get("includeUnconnected") === "true",
    connectedVenues: connectedVenues.length > 0 ? connectedVenues : connectedExchanges,
  };
}

function strategyExchangeApiPlugin(): Plugin {
  return {
    name: "strategy-exchange-api",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = request.url ?? "";

        if (requestUrl.startsWith("/api/strategy-exchange/users/")) {
          const url = new URL(requestUrl, "http://localhost");
          const address = decodeURIComponent(url.pathname.replace("/api/strategy-exchange/users/", ""));
          const payload: UserAccountResponse = {
            endpoint: `${url.pathname}${url.search}`,
            sql: buildUserByAddressSql(address),
            account: selectUserAccountByAddress(address),
          };

          response.statusCode = payload.account ? 200 : 404;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify(payload));
          return;
        }

        if (requestUrl.startsWith("/api/strategy-exchange/discussions/adapters/")) {
          const url = new URL(requestUrl, "http://localhost");
          const address = decodeURIComponent(
            url.pathname.replace("/api/strategy-exchange/discussions/adapters/", ""),
          );
          const payload: VaultDiscussionResponse = {
            endpoint: `${url.pathname}${url.search}`,
            sql: buildVaultDiscussionSql(address),
            messages: selectDiscussionMessagesByVaultAddress(address),
          };

          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify(payload));
          return;
        }

        if (requestUrl.startsWith("/api/strategy-exchange/adapter-addresses/")) {
          const url = new URL(requestUrl, "http://localhost");
          const address = decodeURIComponent(url.pathname.replace("/api/strategy-exchange/adapter-addresses/", ""));
          const adapter = selectVaultByAddress(address);
          const payload: StrategyVaultResponse = {
            endpoint: `${url.pathname}${url.search}`,
            sql: buildVaultByAddressSql(address),
            adapter,
          };

          response.statusCode = payload.adapter ? 200 : 404;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify(payload));
          return;
        }

        if (requestUrl.startsWith("/api/strategy-exchange/adapters/")) {
          const url = new URL(requestUrl, "http://localhost");
          const strategyId = decodeURIComponent(url.pathname.replace("/api/strategy-exchange/adapters/", ""));
          const adapter = selectVaultByStrategyId(strategyId);
          const payload: StrategyVaultResponse = {
            endpoint: `${url.pathname}${url.search}`,
            sql: buildVaultByStrategyIdSql(strategyId),
            adapter,
          };

          response.statusCode = payload.adapter ? 200 : 404;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify(payload));
          return;
        }

        if (!requestUrl.startsWith("/api/strategy-exchange/strategies")) {
          next();
          return;
        }

        const url = new URL(requestUrl, "http://localhost");
        const feedRequest = parseStrategyFeedRequest(url);
        const strategiesForRequest = selectStrategyFeed(feedRequest);
        const payload: StrategyFeedResponse = {
          endpoint: `${url.pathname}${url.search}`,
          request: feedRequest,
          strategies: strategiesForRequest,
          total: strategiesForRequest.length,
        };

        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify(payload));
      });
    },
  };
}

export default defineConfig({
  plugins: [strategyExchangeApiPlugin(), tailwindcss(), react()],
  resolve: {
    alias: {
      ...linkedDependencyAliases,
      "@": path.resolve(__dirname, "../front/src"),
      react: path.resolve(nodeModulesPath, "react"),
      "react-dom": path.resolve(nodeModulesPath, "react-dom"),
      "react/jsx-runtime": path.resolve(nodeModulesPath, "react/jsx-runtime.js"),
      "react/jsx-dev-runtime": path.resolve(nodeModulesPath, "react/jsx-dev-runtime.js"),
    },
    dedupe: ["react", "react-dom"],
  },
});
