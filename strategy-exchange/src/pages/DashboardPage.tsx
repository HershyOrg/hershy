import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "../shared/components";
import { EditMyPage } from "./EditMyPage";
import { LaunchLogicPage } from "./LaunchLogicPage";
import { MyPage } from "./MyPage";
import { AddressRouteNotFound } from "../features/strategy-exchange/components/AddressRouteNotFound";
import { MarketSpotlights } from "../features/strategy-exchange/components/MarketSpotlights";
import { StrategyCard } from "../features/strategy-exchange/components/StrategyCards";
import { UserAddressProfilePage } from "../features/strategy-exchange/components/UserAddressProfilePage";
import { VaultAddressPage } from "../features/strategy-exchange/components/VaultAddressPage";
import { productTypeDisclosureLabels, productTypeLabels } from "../features/strategy-exchange/constants";
import { useStrategyFeed } from "../features/strategy-exchange/hooks/useStrategyFeed";
import {
  browseFilters,
  connectedExchanges,
  productTypes,
  strategies,
} from "../features/strategy-exchange/store/strategyCatalog";
import {
  readBookmarkStore,
  readStrategyPositionStore,
  readUsedStrategyStore,
  writeBookmarkStore,
  writeStrategyPositionStore,
  writeUsedStrategyStore,
} from "../features/strategy-exchange/store/strategyExchangeStore";
import type {
  AddressRoute,
  BrowseFilter,
  ProductType,
} from "../features/strategy-exchange/types/strategyTypes";
import {
  getAddressRouteFromLocation,
  isLaunchLogicPath,
  isMyPageEditPath,
  isMyPagePath,
  launchLogicPath,
  migrateLegacyHashRouteToPath,
  myPageEditPath,
  myPagePath,
  resolveAddressRouteFromAddress,
} from "../features/strategy-exchange/utils/routes";
import {
  selectUserAccountByCreatorId,
  selectVaultByStrategyId,
} from "../../demoDB";

type ThemeMode = "light" | "dark";

function getInitialThemeMode(): ThemeMode {
  const storedTheme = window.localStorage.getItem("strategy-exchange-theme");
  if (storedTheme === "light" || storedTheme === "dark") return storedTheme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function DashboardPage() {
  const [activeProductType, setActiveProductType] = useState<"All" | ProductType>("All");
  const [activeFilter, setActiveFilter] = useState<BrowseFilter>("Featured");
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getInitialThemeMode());
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => readBookmarkStore());
  const [usedStrategies, setUsedStrategies] = useState<Set<string>>(() => readUsedStrategyStore());
  const [strategyPositions, setStrategyPositions] = useState<Record<string, number>>(() => readStrategyPositionStore());
  const [addressRoute, setAddressRoute] = useState<AddressRoute | null>(() => getAddressRouteFromLocation());
  const [isLaunchLogicRoute, setIsLaunchLogicRoute] = useState(() => isLaunchLogicPath());
  const [isMyPageRoute, setIsMyPageRoute] = useState(() => isMyPagePath());
  const [isMyPageEditRoute, setIsMyPageEditRoute] = useState(() => isMyPageEditPath());

  const feedRequest = useMemo(
    () => ({
      category: activeFilter,
      type: activeProductType,
      query,
      includeUnconnected: false,
      connectedVenues: connectedExchanges,
    }),
    [activeFilter, activeProductType, query],
  );
  const { visibleStrategies, feedEndpoint, isFeedLoading } = useStrategyFeed(feedRequest);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", themeMode === "dark");
    root.dataset.theme = themeMode;
    window.localStorage.setItem("strategy-exchange-theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    const handleHashChange = () => {
      const migratedAddress = migrateLegacyHashRouteToPath();
      setAddressRoute(migratedAddress ? resolveAddressRouteFromAddress(migratedAddress) : getAddressRouteFromLocation());
      setIsLaunchLogicRoute(isLaunchLogicPath());
      setIsMyPageRoute(isMyPagePath());
      setIsMyPageEditRoute(isMyPageEditPath());
    };
    migrateLegacyHashRouteToPath();
    setAddressRoute(getAddressRouteFromLocation());
    setIsLaunchLogicRoute(isLaunchLogicPath());
    setIsMyPageRoute(isMyPagePath());
    setIsMyPageEditRoute(isMyPageEditPath());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setAddressRoute(getAddressRouteFromLocation());
      setIsLaunchLogicRoute(isLaunchLogicPath());
      setIsMyPageRoute(isMyPagePath());
      setIsMyPageEditRoute(isMyPageEditPath());
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    writeBookmarkStore(bookmarks);
  }, [bookmarks]);

  useEffect(() => {
    writeUsedStrategyStore(usedStrategies);
  }, [usedStrategies]);

  useEffect(() => {
    writeStrategyPositionStore(strategyPositions);
  }, [strategyPositions]);

  const spotlightStrategies = strategies;

  const handleBookmark = (strategyId: string) => {
    setBookmarks((current) => {
      const next = new Set(current);
      if (next.has(strategyId)) {
        next.delete(strategyId);
      } else {
        next.add(strategyId);
      }
      return next;
    });
  };

  const navigateHome = () => {
    window.history.pushState("", document.title, "/");
    setAddressRoute(null);
    setIsLaunchLogicRoute(false);
    setIsMyPageRoute(false);
    setIsMyPageEditRoute(false);
  };

  const navigateToLaunchLogic = () => {
    window.history.pushState("", document.title, launchLogicPath);
    setAddressRoute(null);
    setIsLaunchLogicRoute(true);
    setIsMyPageRoute(false);
    setIsMyPageEditRoute(false);
  };

  const navigateToMyPage = () => {
    window.history.pushState("", document.title, myPagePath);
    setAddressRoute(null);
    setIsLaunchLogicRoute(false);
    setIsMyPageRoute(true);
    setIsMyPageEditRoute(false);
  };

  const navigateToEditMyPage = () => {
    window.history.pushState("", document.title, myPageEditPath);
    setAddressRoute(null);
    setIsLaunchLogicRoute(false);
    setIsMyPageRoute(false);
    setIsMyPageEditRoute(true);
  };

  const navigateToAddress = (address: string) => {
    window.history.pushState("", document.title, `/${encodeURIComponent(address)}`);
    setAddressRoute(resolveAddressRouteFromAddress(address));
    setIsLaunchLogicRoute(false);
    setIsMyPageRoute(false);
    setIsMyPageEditRoute(false);
  };

  const navigateToVaultAddress = (strategyId: string) => {
    const vault = selectVaultByStrategyId(strategyId);
    if (!vault) return;
    navigateToAddress(vault.address);
  };

  const openCreator = (creatorId: string) => {
    const account = selectUserAccountByCreatorId(creatorId);
    if (account) {
      navigateToAddress(account.eoaAddress);
      return;
    }

    navigateToAddress(creatorId);
  };

  const routedStrategy =
    addressRoute?.kind === "vault"
      ? strategies.find((strategy) => strategy.id === addressRoute.strategyId) ?? null
      : null;
  const myAccount = selectUserAccountByCreatorId("quant.kim");

  const useStrategy = (strategyId: string, amount = 0) => {
    setUsedStrategies((current) => new Set(current).add(strategyId));
    if (amount > 0) {
      setStrategyPositions((current) => ({
        ...current,
        [strategyId]: (current[strategyId] ?? 0) + amount,
      }));
    }
  };

  const dropStrategy = (strategyId: string) => {
    setUsedStrategies((current) => {
      const next = new Set(current);
      next.delete(strategyId);
      return next;
    });
    setStrategyPositions((current) => {
      const next = { ...current };
      delete next[strategyId];
      return next;
    });
  };

  const selectSpotlightFilter = (filter: BrowseFilter) => {
    setActiveFilter(filter);
    setIsCategoryOpen(false);
  };

  return (
    <div className="app-shell">
      <AppHeader
        query={query}
        onQueryChange={setQuery}
        onLaunchLogic={navigateToLaunchLogic}
        onMyPage={navigateToMyPage}
        onHome={navigateHome}
        onBack={addressRoute?.kind === "vault" ? navigateHome : undefined}
        themeMode={themeMode}
        onThemeModeChange={setThemeMode}
      />

      {isLaunchLogicRoute ? (
        <LaunchLogicPage onBack={navigateHome} />
      ) : isMyPageEditRoute && myAccount ? (
        <EditMyPage account={myAccount} onBack={navigateToMyPage} onSaved={navigateToMyPage} />
      ) : isMyPageRoute && myAccount ? (
        <MyPage
          account={myAccount}
          usedStrategyIds={usedStrategies}
          bookmarkedStrategyIds={bookmarks}
          onBack={navigateHome}
          onLaunchLogic={navigateToLaunchLogic}
          onEditProfile={navigateToEditMyPage}
          onStrategySelect={navigateToVaultAddress}
        />
      ) : addressRoute?.kind === "vault" && routedStrategy ? (
        <VaultAddressPage
          address={addressRoute.address}
          strategy={routedStrategy}
          used={usedStrategies.has(routedStrategy.id)}
          netPosition={strategyPositions[routedStrategy.id] ?? 0}
          onCreatorSelect={() => openCreator(routedStrategy.creatorId)}
          onUse={(amount) => useStrategy(routedStrategy.id, amount)}
          onDrop={() => dropStrategy(routedStrategy.id)}
        />
      ) : addressRoute?.kind === "user" ? (
        <UserAddressProfilePage
          address={addressRoute.address}
          onBack={navigateHome}
          onStrategySelect={navigateToVaultAddress}
        />
      ) : addressRoute?.kind === "unknown" ? (
        <AddressRouteNotFound address={addressRoute.address} onBack={navigateHome} />
      ) : (
        <main className="market-layout">
          <section className="market-main">
            <MarketSpotlights
              items={spotlightStrategies}
              onFilterSelect={selectSpotlightFilter}
              onStrategySelect={navigateToVaultAddress}
            />

            <section className="category-stack" aria-label="strategy categories">
              <div className="category-group">
                <div className="category-heading">
                  <span>피드</span>
                  <strong>
                    {activeProductType === "All"
                      ? activeFilter
                      : `${activeFilter} / ${productTypeLabels[activeProductType]}`}
                  </strong>
                </div>
                <nav className="browse-row" aria-label="browse filters">
                  {browseFilters.map((filter) => (
                    <button
                      type="button"
                      key={filter}
                      className={activeFilter === filter ? "active" : ""}
                      onClick={() => setActiveFilter(filter)}
                    >
                      {filter}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={isCategoryOpen || activeProductType !== "All" ? "active" : ""}
                    onClick={() => setIsCategoryOpen((current) => !current)}
                  >
                    상품 유형
                  </button>
                </nav>

                {isCategoryOpen ? (
                  <div className="feed-category-panel">
                    <div className="category-subheading">
                      <span>카테고리</span>
                      <strong>{productTypeDisclosureLabels[activeProductType]}</strong>
                    </div>
                    <nav className="sector-row product-type-row" aria-label="strategy type subcategories">
                      {productTypes.map((productType) => (
                        <button
                          type="button"
                          key={productType}
                          className={activeProductType === productType ? "active" : ""}
                          onClick={() => setActiveProductType(productType)}
                        >
                          <span>{productTypeLabels[productType]}</span>
                          <small>{productTypeDisclosureLabels[productType]}</small>
                        </button>
                      ))}
                    </nav>
                  </div>
                ) : null}
              </div>
            </section>

            <section
              className={`strategy-grid${isFeedLoading ? " loading" : ""}`}
              aria-label="strategy markets"
              data-api-request={feedEndpoint}
            >
              {visibleStrategies.length > 0 ? (
                visibleStrategies.map((strategy) => (
                  <StrategyCard
                    key={strategy.id}
                    strategy={strategy}
                    bookmarked={bookmarks.has(strategy.id)}
                    used={usedStrategies.has(strategy.id)}
                    onBookmark={() => handleBookmark(strategy.id)}
                    onCreatorSelect={() => openCreator(strategy.creatorId)}
                    onOpen={() => navigateToVaultAddress(strategy.id)}
                    onUse={() => useStrategy(strategy.id)}
                  />
                ))
              ) : (
                <div className="empty-state">No strategies</div>
              )}
            </section>
          </section>
        </main>
      )}
    </div>
  );
}
