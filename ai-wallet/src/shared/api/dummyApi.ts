import {
  MOCK_ASSETS,
  MOCK_PLAN,
  MOCK_TRACKERS,
  MOCK_TRANSACTIONS,
  MOCK_WORKSPACE,
} from "@/features/ai-wallet/mock-data/wallet";
import type {
  CommerceTimelineStep,
  CommerceWorkflowAction,
  CommerceWorkflowItem,
  GeneratedPlan,
  TokenAsset,
  TokenTracker,
  WalletWorkspaceSnapshot,
} from "@/features/ai-wallet/types/walletTypes";

type ScrapedPreview = {
  url: string;
  title?: string;
  imageUrl?: string;
  error?: string;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function delay<T>(value: T, ms = 240) {
  return new Promise<T>((resolve) => {
    window.setTimeout(() => resolve(clone(value)), ms);
  });
}

async function scrapePreview(sourceUrl: string): Promise<ScrapedPreview | null> {
  try {
    const response = await fetch(`/api/scrape-preview?url=${encodeURIComponent(sourceUrl)}`);
    if (!response.ok) return null;

    return (await response.json()) as ScrapedPreview;
  } catch {
    return null;
  }
}

async function hydrateActionPreviews(actions: CommerceWorkflowAction[]) {
  return Promise.all(
    actions.map(async (action) => {
      if (action.items?.length) {
        const items = await Promise.all(
          action.items.map(async (item) => {
            if (item.sourceUrl.includes("/search?") || item.sourceUrl.includes("/s?k=")) return item;
            const preview = await scrapePreview(item.sourceUrl);
            if (!preview?.imageUrl) return item;

            return {
              ...item,
              imageUrl: preview.imageUrl,
              imageAlt: preview.title ?? item.imageAlt ?? item.title,
              previewTitle: preview.title,
            };
          }),
        );

        return { ...action, items };
      }

      if (!action.sourceUrl) return action;

      const preview = await scrapePreview(action.sourceUrl);
      if (!preview?.imageUrl) return action;

      return {
        ...action,
        imageUrl: preview.imageUrl,
        imageAlt: preview.title ?? action.imageAlt ?? action.title,
        previewTitle: preview.title,
      };
    }),
  );
}

function formatKrw(value: number) {
  return `₩${new Intl.NumberFormat("ko-KR").format(value)}`;
}

function createWorkflowItem(
  id: string,
  title: string,
  priceValue: number,
  sourceUrl: string,
  isSelected = true,
  detail?: string,
): CommerceWorkflowItem {
  return {
    id,
    title,
    detail,
    quantity: 1,
    priceValue,
    priceLabel: formatKrw(priceValue),
    sourceUrl,
    imageAlt: `${title} product preview`,
    isSelected,
  };
}

function amazonSearchUrl(query: string) {
  return `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
}

function kurlySearchUrl(query: string) {
  return `https://www.kurly.com/search?sword=${encodeURIComponent(query)}`;
}

async function hydratePlanPreviews(plan: GeneratedPlan): Promise<GeneratedPlan> {
  if (!plan.workflowActions?.length) return plan;

  return {
    ...plan,
    workflowActions: await hydrateActionPreviews(plan.workflowActions),
  };
}

function buildAmazonActions(): CommerceWorkflowAction[] {
  return [
    {
      id: "purchase-amazon",
      title: "Buy selected Amazon items",
      detail: "Every candidate is listed below. Uncheck anything you do not want to buy.",
      status: "Ready",
      source: "Amazon",
      sourceUrl: "https://www.amazon.com/Rechargeable-Essentials-Waterproof-Flashlights-Adjustable/dp/B07Y21GMKQ",
      timing: "After confirmation",
      selected: "6 of 7 items selected",
      final: "₩88,300 selected",
      items: [
        createWorkflowItem(
          "amazon-headlamp",
          "Rechargeable camping headlamp",
          24_900,
          "https://www.amazon.com/Rechargeable-Essentials-Waterproof-Flashlights-Adjustable/dp/B07Y21GMKQ",
        ),
        createWorkflowItem("amazon-bottle", "Stanley insulated travel bottle", 18_900, "https://www.amazon.com/Stanley-Unisex-Adults-Travel-Green/dp/B07J5GZM21"),
        createWorkflowItem("amazon-first-aid", "Compact first aid kit", 15_900, amazonSearchUrl("compact first aid kit camping")),
        createWorkflowItem("amazon-utensils", "Camping utensil set", 9_900, amazonSearchUrl("camping utensil set")),
        createWorkflowItem("amazon-dry-bag", "Waterproof dry bag", 12_900, amazonSearchUrl("HEETA waterproof dry bag camping")),
        createWorkflowItem("amazon-blanket", "Emergency thermal blanket", 5_900, amazonSearchUrl("emergency thermal blanket camping")),
        createWorkflowItem("amazon-power-bank", "Portable power bank", 27_900, amazonSearchUrl("portable power bank camping"), false, "Excluded to keep the cart under the approved limit."),
      ],
    },
  ];
}

function buildCampingActions(): CommerceWorkflowAction[] {
  return [
    {
      id: "reserve-stay",
      title: "Reserve a suitable stay",
      detail: "Availability and location checked",
      status: "Ready",
      source: "Naver Travel",
      sourceUrl:
        "https://search.naver.com/search.naver?query=%EC%96%91%ED%8F%89%20%EC%BA%A0%ED%95%91%EC%9E%A5%20%EC%98%88%EC%95%BD",
      imageAlt: "Yangpyeong campsite preview",
      placeName: "Yangpyeong riverside campsite",
      placeAddress: "Yangpyeong-gun, Gyeonggi-do",
      mapUrl:
        "https://map.naver.com/p/search/%EC%96%91%ED%8F%89%20%EA%B0%95%EB%B3%80%20%EC%BA%A0%ED%95%91%EC%9E%A5",
      timing: "Friday-Sunday",
      selected: "Yangpyeong riverside stay • 2 nights",
      final: "₩88,000 est.",
      items: [
        createWorkflowItem(
          "stay-yangpyeong",
          "Yangpyeong riverside campsite • 2 nights",
          88_000,
          "https://search.naver.com/search.naver?query=%EC%96%91%ED%8F%89%20%EC%BA%A0%ED%95%91%EC%9E%A5%20%EC%98%88%EC%95%BD",
        ),
      ],
    },
    {
      id: "order-groceries",
      title: "Order groceries for two nights",
      detail: "Meal essentials grouped into one order",
      status: "Ready",
      source: "Market Kurly",
      sourceUrl: "https://www.kurly.com/goods/1001635039",
      imageAlt: "Groceries selected for two nights",
      timing: "Friday • 3-5 PM",
      selected: "Breakfasts, trail lunches, dinner, snacks • 18 items",
      final: "₩68,000 est.",
      items: [
        createWorkflowItem("grocery-granola", "Breakfast granola", 4_200, kurlySearchUrl("그래놀라")),
        createWorkflowItem("grocery-milk", "Milk 1L", 2_800, kurlySearchUrl("우유 1L")),
        createWorkflowItem("grocery-eggs", "Eggs • 10 pack", 3_900, kurlySearchUrl("달걀 10구")),
        createWorkflowItem("grocery-bagels", "Bagels • 4 pack", 4_500, kurlySearchUrl("베이글")),
        createWorkflowItem(
          "grocery-sandwiches",
          "Beef rolls & soybean stew meal set",
          12_900,
          "https://www.kurly.com/goods/1001635039",
        ),
        createWorkflowItem("grocery-chicken", "Spam chicken breast 200g", 3_500, "https://www.kurly.com/goods/1000632199"),
        createWorkflowItem("grocery-rice", "Instant rice • 4 pack", 4_800, kurlySearchUrl("즉석밥")),
        createWorkflowItem("grocery-kimchi", "Kimchi 500g", 3_900, kurlySearchUrl("김치 500g")),
        createWorkflowItem("grocery-ramen", "Ramen • 4 pack", 4_200, kurlySearchUrl("라면 4개")),
        createWorkflowItem("grocery-marshmallows", "Marshmallows", 3_300, kurlySearchUrl("마시멜로")),
        createWorkflowItem("grocery-coffee", "Center Coffee No.7 drip bags", 13_500, "https://www.kurly.com/goods/5013215"),
        createWorkflowItem("grocery-water", "Mineral water 2L • 3", 2_700, kurlySearchUrl("생수 2L")),
        createWorkflowItem("grocery-nuts", "Mixed nuts", 4_200, kurlySearchUrl("믹스넛")),
        createWorkflowItem("grocery-bananas", "Bananas", 3_200, kurlySearchUrl("바나나")),
        createWorkflowItem("grocery-apples", "Apples • 4 pack", 4_800, kurlySearchUrl("사과 4입")),
        createWorkflowItem("grocery-bars", "Snack bars", 3_900, kurlySearchUrl("에너지바")),
        createWorkflowItem("grocery-cups", "Paper cups", 1_800, kurlySearchUrl("종이컵")),
        createWorkflowItem("grocery-trash-bags", "Trash bags", 1_500, kurlySearchUrl("쓰레기봉투")),
      ],
    },
    {
      id: "buy-gear",
      title: "Buy missing camping essentials",
      detail: "Gear selected from the approved list",
      status: "Ready",
      source: "Amazon",
      sourceUrl: "https://www.amazon.com/Amazon-Basics-Outdoor-Essentials-headlamps/dp/B0DYSWT59X",
      imageAlt: "Camping essentials preview",
      timing: "Arrives before Friday",
      selected: "Rain cover, headlamp batteries, fuel canister • 3 items",
      final: "₩96,400 est.",
      items: [
        createWorkflowItem("gear-rain-cover", "Waterproof rain cover", 39_000, amazonSearchUrl("waterproof camping rain cover")),
        createWorkflowItem(
          "gear-headlamp",
          "Amazon Basics headlamp batteries",
          17_400,
          "https://www.amazon.com/Amazon-Basics-Outdoor-Essentials-headlamps/dp/B0DYSWT59X",
        ),
        createWorkflowItem("gear-fuel", "Camping fuel canister", 40_000, amazonSearchUrl("camping fuel canister")),
      ],
    },
  ];
}

function buildCampingTimeline(): CommerceTimelineStep[] {
  return [
    {
      id: "camping-timeline-1",
      time: "Today",
      title: "Confirm location and stay",
      detail: "Pick a Yangpyeong option that matches the date, distance, and budget.",
    },
    {
      id: "camping-timeline-2",
      time: "Friday afternoon",
      title: "Receive groceries and gear",
      detail: "Orders arrive before departure so the trip can start without extra stops.",
    },
    {
      id: "camping-timeline-3",
      time: "Friday-Sunday",
      title: "Trip window",
      detail: "Check in, stay two nights, and keep receipts attached to the plan.",
    },
  ];
}

function getSelectionStats(actions: CommerceWorkflowAction[]) {
  const items = actions.flatMap((action) => action.items ?? []);
  const selectedItems = items.filter((item) => item.isSelected);

  return {
    selectedCount: selectedItems.length,
    totalCount: items.length,
    totalValue: selectedItems.reduce((sum, item) => sum + item.priceValue * item.quantity, 0),
  };
}

export async function getWalletWorkspaceSnapshot(): Promise<WalletWorkspaceSnapshot> {
  const snapshot = await delay(MOCK_WORKSPACE, 120);
  const workflowActions = buildCampingActions();
  const selection = getSelectionStats(workflowActions);
  const activePlan = await hydratePlanPreviews({
    ...snapshot.activePlan,
    approvalStatus: "draft",
    workflowActions,
    totalLabel: formatKrw(selection.totalValue),
    totalDetail: `${selection.selectedCount} selected items`,
  });

  return {
    ...snapshot,
    activePlan,
  };
}

export async function createGeneratedPlan(prompt: string): Promise<GeneratedPlan> {
  const normalizedPrompt = prompt.trim();
  const isAmazon = /아마존|amazon|10만원|100,?000/i.test(normalizedPrompt);
  const workflowActions = isAmazon ? buildAmazonActions() : buildCampingActions();
  const selection = getSelectionStats(workflowActions);
  const timeline = isAmazon ? undefined : buildCampingTimeline();
  const budgetCategoryId = isAmazon ? "asset-shopping" : "asset-travel";
  const budgetCategoryName = isAmazon ? "Amazon purchase session" : "Yangpyeong camping session";
  const budgetAllocatedUsd = isAmazon ? 100 : 500;
  const budgetReservedUsd = isAmazon ? 96.4 : 238.7;
  const plan: GeneratedPlan = {
    ...clone(MOCK_PLAN),
    id: `plan-${Date.now()}`,
    userPrompt: normalizedPrompt,
    generatedAt: new Date().toISOString(),
    approvalStatus: "draft",
    title: isAmazon ? "Amazon budget purchase" : "Yangpyeong camping weekend",
    summary: isAmazon
      ? "업로드된 물건 목록을 예산 안에서 정리하고, 아마존 장바구니로 바로 실행할 수 있게 나눴습니다."
      : "양평 숙소 예약을 먼저 고정하고, 필요한 장보기와 캠핑 준비물을 이어서 처리할 수 있게 구성했습니다.",
    explanation: isAmazon
      ? "Thirdeye는 목록을 먼저 정리한 뒤 가격과 배송 조건을 비교하고, 승인된 한도 안에서만 결제를 진행합니다."
      : "Thirdeye는 날짜와 위치를 먼저 확정한 뒤 숙소, 식료품, 준비물을 분리해 예산과 일정 충돌을 줄입니다.",
    analysisSignals: isAmazon
      ? ["Item list provided", "₩100,000 limit", "Amazon purchase", "Delivery needed", "Duplicates removed", "Options assembled"]
      : ["Two-night trip", "This weekend", "Yangpyeong area", "Stay required", "Gear and groceries", "Options assembled"],
    workflowActions,
    timeline,
    totalLabel: formatKrw(selection.totalValue),
    totalDetail: `${selection.selectedCount} of ${selection.totalCount} items selected`,
    budgetCategoryId,
    budgetCategoryName,
    budgetAllocatedUsd,
    budgetReservedUsd,
    lockedAssets: isAmazon ? [{ symbol: "Shop", amount: 96.4, usdValue: 96.4 }] : [{ symbol: "Trip", amount: 238.7, usdValue: 238.7 }],
    allowedAction: {
      ...MOCK_PLAN.allowedAction,
      functionName: isAmazon ? "purchaseApprovedCart" : "reserveAndPurchase",
      parameters: [
        { name: "intent", value: normalizedPrompt },
        { name: "vendors", value: isAmazon ? "Amazon" : "Naver Travel, Market Kurly, Amazon" },
        { name: "limit", value: isAmazon ? "₩100,000" : "Session budget" },
      ],
    },
  };

  const hydratedPlan = await hydratePlanPreviews(plan);

  return delay(hydratedPlan, 120);
}

export function executeGeneratedPlan(plan: GeneratedPlan): Promise<{
  plan: GeneratedPlan;
  confirmationId: string;
}> {
  const actions = plan.workflowActions ?? [];
  const selection = getSelectionStats(actions);
  const completedActions = actions.map((action) => {
    const selectedItems = action.items?.filter((item) => item.isSelected) ?? [];
    const actionValue = selectedItems.reduce((sum, item) => sum + item.priceValue * item.quantity, 0);

    return {
      ...action,
      status: selectedItems.length === 0 ? "Skipped" : action.id.includes("reserve") ? "Reserved" : "Purchased",
      selected: `${selectedItems.length} of ${action.items?.length ?? 0} items selected`,
      final: formatKrw(actionValue),
    };
  }) as CommerceWorkflowAction[];

  return delay(
    {
      plan: {
        ...plan,
        approvalStatus: "executed",
        workflowActions: completedActions,
        totalLabel: formatKrw(selection.totalValue),
        totalDetail: `${selection.selectedCount} purchased or reserved items`,
      },
      confirmationId: `ORDER-${Math.random().toString(16).slice(2, 6).toUpperCase()}`,
    },
    640,
  );
}

export function refreshPortfolioSnapshot(): Promise<TokenAsset[]> {
  const refreshedAssets = MOCK_ASSETS.map((asset, index) => ({
    ...asset,
    change24h: Number((asset.change24h + (index % 2 === 0 ? 0.01 : -0.01)).toFixed(2)),
  }));

  return delay(refreshedAssets, 180);
}

export function addDummyTokenTracker(symbol: string, contractAddress: string): Promise<{
  tracker: TokenTracker;
  asset: TokenAsset;
}> {
  const cleanSymbol = symbol.trim() || "Custom";
  const tracker: TokenTracker = {
    id: `tracker-${cleanSymbol.toLowerCase()}-${Date.now()}`,
    symbol: cleanSymbol,
    contractAddress: contractAddress.trim() || `internal-budget:${cleanSymbol.toLowerCase()}`,
    enabled: true,
    source: "custom",
  };
  const asset: TokenAsset = {
    id: `asset-${cleanSymbol.toLowerCase()}-${Date.now()}`,
    symbol: cleanSymbol,
    name: `${cleanSymbol} budget`,
    contractAddress: tracker.contractAddress,
    balance: 0,
    lockedBalance: 0,
    fiatPrice: 1,
    change24h: 0,
    color: "#14b8a6",
    decimals: 2,
    isMajor: false,
  };

  return delay({ tracker, asset }, 220);
}

export function getDefaultTokenTrackers(): Promise<TokenTracker[]> {
  return delay(MOCK_TRACKERS);
}

export function getRecentTransactions() {
  return delay(MOCK_TRANSACTIONS);
}
