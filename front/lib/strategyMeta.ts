import type { HistorySnapshot } from "@/lib/historyStore";

export type StrategyKind = "dca" | "hedge" | "generic";

export type DcaAllocation = {
  asset: string;
  symbol: string;
  weight: number;
  exchange: string;
  label: string;
};

export type DcaPlan = {
  monthlyBudget: number;
  cadenceLabel: string;
  exchange: string;
  allocations: DcaAllocation[];
};

function getSnapshotName(snapshot?: HistorySnapshot | null) {
  if (!snapshot) return "";
  return `${snapshot.name} ${(snapshot.nodes ?? [])
    .map((node: any) => `${node?.data?.label ?? ""} ${node?.data?.functionName ?? ""}`)
    .join(" ")}`.toLowerCase();
}

export function getPrimaryStrategyLabel(snapshot?: HistorySnapshot | null) {
  if (!snapshot) return "전략";

  const solidGroup = (snapshot.nodes ?? []).find(
    (node: any) => node.type === "groupNode" && node.data?.styleType === "solid",
  );

  return solidGroup?.data?.label ?? snapshot.name ?? "전략";
}

export function detectStrategyKind(snapshot?: HistorySnapshot | null): StrategyKind {
  if (!snapshot) return "generic";

  const haystack = getSnapshotName(snapshot);
  const hasDcaKeyword =
    haystack.includes("dca") ||
    haystack.includes("etf") ||
    haystack.includes("적립") ||
    haystack.includes("매달");
  const hasHedgeKeyword =
    haystack.includes("hedge") ||
    haystack.includes("pepe") ||
    haystack.includes("유동성") ||
    haystack.includes("리밸런싱");

  const hasMonthlyTrigger = (snapshot.nodes ?? []).some((node: any) => {
    return node.type === "timeTrigger" && Number(node.data?.interval) >= 60 * 60 * 24 * 28;
  });

  if (hasDcaKeyword || hasMonthlyTrigger) return "dca";
  if (hasHedgeKeyword) return "hedge";
  return "generic";
}

export function extractDcaPlan(snapshot?: HistorySnapshot | null): DcaPlan {
  const defaultPlan: DcaPlan = {
    monthlyBudget: 500,
    cadenceLabel: "월 1회",
    exchange: "Binance",
    allocations: [],
  };

  if (!snapshot) return defaultPlan;

  const functionNode = (snapshot.nodes ?? []).find((node: any) => node.type === "functionNode");
  const timeTrigger = (snapshot.nodes ?? []).find((node: any) => node.type === "timeTrigger");
  const actionNodes = (snapshot.nodes ?? []).filter((node: any) => node.type === "actionNode");

  const labelText = `${functionNode?.data?.label ?? ""} ${functionNode?.data?.code ?? ""}`;
  const budgetMatch = labelText.match(/\$(\d[\d,]*)/);
  const monthlyBudget = budgetMatch ? Number(budgetMatch[1].replace(/,/g, "")) : defaultPlan.monthlyBudget;

  const cadenceLabel =
    Number(timeTrigger?.data?.interval) >= 60 * 60 * 24 * 28
      ? "월 1회"
      : timeTrigger?.data?.label ?? defaultPlan.cadenceLabel;

  const allocations = actionNodes
    .map((node: any) => {
      const symbol = node.data?.symbol ?? "";
      const asset = symbol ? String(symbol).split("/")[0] : String(node.data?.label ?? "ASSET");
      const rawWeight = Number(node.data?.amount ?? 0);

      return {
        asset,
        symbol: symbol || `${asset}/USDT`,
        weight: Number.isFinite(rawWeight) ? rawWeight : 0,
        exchange: node.data?.exchange ?? defaultPlan.exchange,
        label: node.data?.label ?? asset,
      } satisfies DcaAllocation;
    })
    .filter((item) => item.weight > 0);

  return {
    monthlyBudget,
    cadenceLabel,
    exchange: allocations[0]?.exchange ?? defaultPlan.exchange,
    allocations,
  };
}
