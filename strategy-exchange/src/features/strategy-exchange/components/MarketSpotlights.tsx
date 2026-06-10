import { browseFilters, creators } from "../store/strategyCatalog";
import type { BrowseFilter, Strategy } from "../types/strategyTypes";
import { getSpotlightMetric, sortStrategiesByFilter } from "../utils/strategyMetrics";

export function MarketSpotlights({
  items,
  onFilterSelect,
  onStrategySelect,
}: {
  items: Strategy[];
  onFilterSelect: (filter: BrowseFilter) => void;
  onStrategySelect: (strategyId: string) => void;
}) {
  return (
    <section className="spotlight-grid" aria-label="market spotlight">
      {browseFilters.map((filter) => {
        const leaders = sortStrategiesByFilter(items, filter).slice(0, 3);
        return (
          <article key={filter} className="spotlight-card">
            <header className="spotlight-heading">
              <strong>{filter}</strong>
              <button type="button" onClick={() => onFilterSelect(filter)}>
                More
              </button>
            </header>
            <div className="spotlight-list">
              {leaders.map((strategy, index) => {
                const creator = creators[strategy.creatorId];
                return (
                  <button
                    type="button"
                    key={strategy.id}
                    className="spotlight-row"
                    onClick={() => onStrategySelect(strategy.id)}
                  >
                    <span className="spotlight-rank">{index + 1}</span>
                    <span>
                      <strong>{strategy.title}</strong>
                      <em>{creator.name}</em>
                    </span>
                    <div className="spotlight-score">
                      <b className={filter === "Top Volume" || filter === "New" ? "" : "positive"}>
                        {getSpotlightMetric(strategy, filter)}
                      </b>
                    </div>
                  </button>
                );
              })}
            </div>
          </article>
        );
      })}
    </section>
  );
}
