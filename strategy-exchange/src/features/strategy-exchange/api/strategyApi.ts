import {
  connectedExchanges,
  creators,
  strategies,
} from "../store/strategyCatalog";
import {
  launchUserStrategyLogic,
  readUserStrategyLogics,
} from "../store/strategyLogicStore";
import type {
  BrowseFilter,
  GraphEdge,
  GraphNode,
  Sector,
  Strategy,
  StrategyLogicDraft,
  UserProfileDraft,
  UserProfileView,
  UserStrategyLogic,
} from "../types/strategyTypes";
import { getJson, patchJson, postJson } from "../../../shared/api/client";
import { updateUserProfile } from "../store/userProfileStore";
import { z, type ZodType } from "zod";
import {
  buildVaultActivityEndpoint,
  buildVaultActivitySql,
  buildUserByAddressEndpoint,
  buildUserByAddressSql,
  buildVaultByAddressEndpoint,
  buildVaultByAddressSql,
  buildVaultDiscussionEndpoint,
  buildVaultDiscussionSql,
  buildVaultMetadataEndpoint,
  buildVaultByStrategyIdSql,
  selectDiscussionMessagesByVaultAddress,
  selectUserAccountByAddress,
  selectVaultActivityTransactionsByVaultAddress,
  selectVaultActivityUsersByVaultAddress,
  selectVaultByAddress,
  selectVaultByStrategyId,
  type StrategyVaultResponse,
  type UserAccountResponse,
  type VaultActivityResponse,
  type VaultDiscussionResponse,
} from "../../../../demoDB";

export type StrategyFeedRequest = {
  category: BrowseFilter;
  type: "All" | Sector;
  query: string;
  includeUnconnected: boolean;
  connectedVenues?: string[];
};

export type StrategyFeedResponse = {
  endpoint: string;
  request: StrategyFeedRequest;
  strategies: Strategy[];
  total: number;
};

export type UserStrategyLogicsResponse = {
  endpoint: string;
  logics: UserStrategyLogic[];
  total: number;
};

export type LaunchUserStrategyLogicResponse = {
  endpoint: string;
  logic: UserStrategyLogic;
};

export type UpdateUserProfileResponse = {
  endpoint: string;
  profile: UserProfileView;
};

const sectorSchema: ZodType<Sector> = z.enum(["CEX", "DeFi", "Mixed", "Funding", "Basis", "LP/Hedge"]);
const browseFilterSchema: ZodType<BrowseFilter> = z.enum(["Daily Hot", "New", "Top Gainer", "Top Volume"]);
const graphNodeSchema: ZodType<GraphNode> = z.object({
  id: z.string(),
  label: z.string(),
  x: z.number(),
  y: z.number(),
});
const graphEdgeSchema: ZodType<GraphEdge> = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string(),
});
const strategySchema: ZodType<Strategy> = z.object({
  id: z.string(),
  title: z.string(),
  creatorId: z.string(),
  primarySector: sectorSchema,
  sectors: z.array(sectorSchema),
  venues: z.array(z.string()),
  chains: z.array(z.string()),
  pnlSeries: z.array(z.number()),
  realizedPnl: z.number(),
  pnlPct: z.number(),
  deployedCapital: z.number(),
  dailyVolume: z.number(),
  winRate: z.number(),
  maxDrawdown: z.number(),
  traders: z.number(),
  status: z.enum(["Live", "Cooling", "Paused"]),
  createdAt: z.string(),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
});

const strategyFeedResponseSchema = z.object({
  endpoint: z.string(),
  request: z.object({
    category: browseFilterSchema,
    type: z.union([z.literal("All"), sectorSchema]),
    query: z.string(),
    includeUnconnected: z.boolean(),
    connectedVenues: z.array(z.string()).optional(),
  }),
  strategies: z.array(strategySchema),
  total: z.number(),
}) satisfies ZodType<StrategyFeedResponse>;

const userStrategyLogicSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  strategyText: z.string(),
  baseLogicId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) as ZodType<UserStrategyLogic>;

const userStrategyLogicsResponseSchema = z.object({
  endpoint: z.string(),
  logics: z.array(userStrategyLogicSchema),
  total: z.number(),
}) as ZodType<UserStrategyLogicsResponse>;

const launchUserStrategyLogicResponseSchema = z.object({
  endpoint: z.string(),
  logic: userStrategyLogicSchema,
}) as ZodType<LaunchUserStrategyLogicResponse>;

const userProfileSchema = z.object({
  creatorId: z.string(),
  name: z.string(),
  handle: z.string(),
  bio: z.string(),
  avatarUrl: z.string(),
  twitter: z.string(),
  github: z.string(),
  exchanges: z.array(z.string()),
  chains: z.array(z.string()),
  updatedAt: z.string().optional(),
}) as ZodType<UserProfileView>;

const updateUserProfileResponseSchema = z.object({
  endpoint: z.string(),
  profile: userProfileSchema,
}) as ZodType<UpdateUserProfileResponse>;

const vaultResponseSchema = z.object({
  endpoint: z.string(),
  sql: z.string(),
  vault: z.unknown().nullable(),
}) as ZodType<StrategyVaultResponse>;

const userResponseSchema = z.object({
  endpoint: z.string(),
  sql: z.string(),
  account: z.unknown().nullable(),
}) as ZodType<UserAccountResponse>;

const discussionResponseSchema = z.object({
  endpoint: z.string(),
  sql: z.string(),
  messages: z.array(z.unknown()),
}) as ZodType<VaultDiscussionResponse>;

const activityResponseSchema = z.object({
  endpoint: z.string(),
  sql: z.string(),
  users: z.array(z.unknown()),
  transactions: z.array(z.unknown()),
}) as ZodType<VaultActivityResponse>;

function getCreatedAtHours(createdAt: string) {
  const match = createdAt.match(/^(\d+)([hd])$/);
  if (!match) return Number.POSITIVE_INFINITY;
  const value = Number(match[1]);
  return match[2] === "d" ? value * 24 : value;
}

function getHotScore(strategy: Strategy) {
  return strategy.traders * 1.2 + strategy.dailyVolume / 1800 + strategy.pnlPct * 18;
}

function sortStrategiesByCategory(items: Strategy[], category: BrowseFilter) {
  return [...items].sort((a, b) => {
    if (category === "New") return getCreatedAtHours(a.createdAt) - getCreatedAtHours(b.createdAt);
    if (category === "Top Gainer") return b.pnlPct - a.pnlPct;
    if (category === "Top Volume") return b.dailyVolume - a.dailyVolume;
    return getHotScore(b) - getHotScore(a);
  });
}

function getDisconnectedVenues(strategy: Strategy, connectedVenueSet: Set<string>) {
  return strategy.venues.filter((venue) => !connectedVenueSet.has(venue));
}

export function buildStrategyFeedEndpoint(request: StrategyFeedRequest) {
  const params = new URLSearchParams({
    category: request.category,
    type: request.type,
    includeUnconnected: String(request.includeUnconnected),
  });
  const normalizedQuery = request.query.trim();
  if (normalizedQuery) params.set("q", normalizedQuery);
  (request.connectedVenues ?? connectedExchanges).forEach((venue) => {
    params.append("connected", venue);
  });
  return `/api/strategy-exchange/strategies?${params.toString()}`;
}

export function buildUserStrategyLogicsEndpoint() {
  return "/api/strategy-exchange/user-logics";
}

export function buildUpdateUserProfileEndpoint(address: string) {
  return `/api/strategy-exchange/users/${encodeURIComponent(address)}/profile`;
}

export function selectStrategyFeed(request: StrategyFeedRequest) {
  const connectedVenueSet = new Set(request.connectedVenues ?? connectedExchanges);
  const normalizedQuery = request.query.trim().toLowerCase();
  const filtered = strategies.filter((strategy) => {
    const creator = creators[strategy.creatorId];
    const sectorMatch = request.type === "All" || strategy.sectors.includes(request.type);
    const connectionMatch =
      request.includeUnconnected || getDisconnectedVenues(strategy, connectedVenueSet).length === 0;
    const queryMatch =
      !normalizedQuery ||
      strategy.title.toLowerCase().includes(normalizedQuery) ||
      creator.name.toLowerCase().includes(normalizedQuery) ||
      creator.handle.toLowerCase().includes(normalizedQuery) ||
      strategy.venues.some((venue) => venue.toLowerCase().includes(normalizedQuery)) ||
      strategy.chains.some((chain) => chain.toLowerCase().includes(normalizedQuery));

    return sectorMatch && connectionMatch && queryMatch;
  });

  if (!request.includeUnconnected) {
    return sortStrategiesByCategory(filtered, request.category);
  }

  const connected = filtered.filter((strategy) => getDisconnectedVenues(strategy, connectedVenueSet).length === 0);
  const unconnected = filtered.filter((strategy) => getDisconnectedVenues(strategy, connectedVenueSet).length > 0);
  return [
    ...sortStrategiesByCategory(connected, request.category),
    ...sortStrategiesByCategory(unconnected, request.category),
  ];
}

export async function requestStrategyFeed(request: StrategyFeedRequest): Promise<StrategyFeedResponse> {
  const endpoint = buildStrategyFeedEndpoint(request);

  const apiResponse = await getJson(endpoint, strategyFeedResponseSchema);
  if (apiResponse) {
    return apiResponse;
  }

  await new Promise((resolve) => globalThis.setTimeout(resolve, 80));

  const strategiesForRequest = selectStrategyFeed(request);
  return {
    endpoint,
    request,
    strategies: strategiesForRequest,
    total: strategiesForRequest.length,
  };
}

export async function requestUserStrategyLogics(): Promise<UserStrategyLogicsResponse> {
  const endpoint = buildUserStrategyLogicsEndpoint();
  const apiResponse = await getJson(endpoint, userStrategyLogicsResponseSchema);
  if (apiResponse) return apiResponse;

  await new Promise((resolve) => globalThis.setTimeout(resolve, 80));

  const logics = readUserStrategyLogics();
  return {
    endpoint,
    logics,
    total: logics.length,
  };
}

export async function requestLaunchUserStrategyLogic(
  draft: StrategyLogicDraft,
): Promise<LaunchUserStrategyLogicResponse> {
  const endpoint = buildUserStrategyLogicsEndpoint();
  const apiResponse = await postJson(endpoint, draft, launchUserStrategyLogicResponseSchema);
  if (apiResponse) return apiResponse;

  await new Promise((resolve) => globalThis.setTimeout(resolve, 80));

  return {
    endpoint,
    logic: launchUserStrategyLogic(draft),
  };
}

export async function requestUpdateUserProfile(
  address: string,
  creatorId: string,
  draft: UserProfileDraft,
): Promise<UpdateUserProfileResponse> {
  const endpoint = buildUpdateUserProfileEndpoint(address);
  const apiResponse = await patchJson(endpoint, draft, updateUserProfileResponseSchema);
  if (apiResponse) return apiResponse;

  await new Promise((resolve) => globalThis.setTimeout(resolve, 80));

  return {
    endpoint,
    profile: updateUserProfile(creatorId, draft),
  };
}

export async function requestVaultMetadata(strategyId: string): Promise<StrategyVaultResponse> {
  const endpoint = buildVaultMetadataEndpoint(strategyId);
  const apiResponse = await getJson(endpoint, vaultResponseSchema);
  if (apiResponse) return apiResponse;

  await new Promise((resolve) => globalThis.setTimeout(resolve, 80));

  return {
    endpoint,
    sql: buildVaultByStrategyIdSql(strategyId),
    vault: selectVaultByStrategyId(strategyId),
  };
}

export async function requestVaultMetadataByAddress(address: string): Promise<StrategyVaultResponse> {
  const endpoint = buildVaultByAddressEndpoint(address);
  const apiResponse = await getJson(endpoint, vaultResponseSchema);
  if (apiResponse) return apiResponse;

  await new Promise((resolve) => globalThis.setTimeout(resolve, 80));

  return {
    endpoint,
    sql: buildVaultByAddressSql(address),
    vault: selectVaultByAddress(address),
  };
}

export async function requestUserAccountByAddress(address: string): Promise<UserAccountResponse> {
  const endpoint = buildUserByAddressEndpoint(address);
  const apiResponse = await getJson(endpoint, userResponseSchema);
  if (apiResponse) return apiResponse;

  await new Promise((resolve) => globalThis.setTimeout(resolve, 80));

  return {
    endpoint,
    sql: buildUserByAddressSql(address),
    account: selectUserAccountByAddress(address),
  };
}

export async function requestVaultDiscussion(address: string): Promise<VaultDiscussionResponse> {
  const endpoint = buildVaultDiscussionEndpoint(address);
  const apiResponse = await getJson(endpoint, discussionResponseSchema);
  if (apiResponse) return apiResponse;

  await new Promise((resolve) => globalThis.setTimeout(resolve, 80));

  return {
    endpoint,
    sql: buildVaultDiscussionSql(address),
    messages: selectDiscussionMessagesByVaultAddress(address),
  };
}

export async function requestVaultActivity(address: string): Promise<VaultActivityResponse> {
  const endpoint = buildVaultActivityEndpoint(address);
  const apiResponse = await getJson(endpoint, activityResponseSchema);
  if (apiResponse) return apiResponse;

  await new Promise((resolve) => globalThis.setTimeout(resolve, 80));

  return {
    endpoint,
    sql: buildVaultActivitySql(address),
    users: selectVaultActivityUsersByVaultAddress(address),
    transactions: selectVaultActivityTransactionsByVaultAddress(address),
  };
}
