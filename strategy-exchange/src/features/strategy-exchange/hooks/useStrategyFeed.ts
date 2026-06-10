import { useEffect, useState } from "react";
import {
  buildStrategyFeedEndpoint,
  requestStrategyFeed,
  selectStrategyFeed,
  type StrategyFeedRequest,
} from "../api/strategyApi";
import type { Strategy } from "../types/strategyTypes";

export function useStrategyFeed(request: StrategyFeedRequest) {
  const [visibleStrategies, setVisibleStrategies] = useState<Strategy[]>(() => selectStrategyFeed(request));
  const [feedEndpoint, setFeedEndpoint] = useState(() => buildStrategyFeedEndpoint(request));
  const [isFeedLoading, setIsFeedLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setFeedEndpoint(buildStrategyFeedEndpoint(request));
    setIsFeedLoading(true);
    requestStrategyFeed(request)
      .then((response) => {
        if (cancelled) return;
        setVisibleStrategies(response.strategies);
        setFeedEndpoint(response.endpoint);
      })
      .finally(() => {
        if (!cancelled) {
          setIsFeedLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    request.category,
    request.type,
    request.query,
    request.includeUnconnected,
    request.connectedVenues?.join("|"),
  ]);

  return {
    visibleStrategies,
    feedEndpoint,
    isFeedLoading,
  };
}
