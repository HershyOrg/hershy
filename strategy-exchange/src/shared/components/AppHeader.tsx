import { Button } from "./Button";
import { ThirdeyeLogo } from "./ThirdeyeLogo";

type AppHeaderProps = {
  query: string;
  onQueryChange: (query: string) => void;
  onLaunchLogic: () => void;
  onMyPage: () => void;
  onHome: () => void;
  onBack?: () => void;
  themeMode: "light" | "dark";
  onThemeModeChange: (mode: "light" | "dark") => void;
};

export function AppHeader({
  query,
  onQueryChange,
  onLaunchLogic,
  onMyPage,
  onHome,
  onBack,
  themeMode,
  onThemeModeChange,
}: AppHeaderProps) {
  return (
    <header className="topbar">
      <div className="brand-lockup">
        <button type="button" className="brand-home-button" onClick={onHome} aria-label="Go to main page">
          <span className="brand-mark">
            <ThirdeyeLogo className="brand-logo" />
          </span>
          <div>
            <strong>Thirdeye Arena</strong>
          </div>
        </button>
        {onBack ? (
          <Button variant="back" className="topbar-back-button" onClick={onBack}>
            Back
          </Button>
        ) : null}
      </div>
      <div className="topbar-actions">
        <input
          type="search"
          placeholder="Search strategies, creators, venues"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <Button onClick={onLaunchLogic}>Launch Logic</Button>
        <Button onClick={onMyPage}>My Page</Button>
        <button
          type="button"
          className="theme-mode-button"
          aria-label={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}
          onClick={() => onThemeModeChange(themeMode === "dark" ? "light" : "dark")}
        >
          {themeMode === "dark" ? "Light" : "Dark"}
        </button>
      </div>
    </header>
  );
}
