import * as React from "react";
import {
  readThemePreference,
  writeThemePreference,
} from "@/shared/store/clientStateStore";

type Theme = "dark" | "light" | "system";
type ResolvedTheme = "dark" | "light";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
  attribute?: "class" | "data-theme";
  enableSystem?: boolean;
  enableColorScheme?: boolean;
  disableTransitionOnChange?: boolean;
};

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

const THEME_STORAGE_KEY = "hershy-theme";
const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredTheme(storageKey: string, fallback: Theme): Theme {
  void storageKey;
  const stored = readThemePreference();
  return stored === "dark" || stored === "light" || stored === "system" ? stored : fallback;
}

function applyTheme({
  attribute,
  enableColorScheme,
  resolvedTheme,
}: {
  attribute: "class" | "data-theme";
  enableColorScheme: boolean;
  resolvedTheme: ResolvedTheme;
}) {
  const root = document.documentElement;
  if (attribute === "class") {
    root.classList.toggle("dark", resolvedTheme === "dark");
  } else {
    root.dataset.theme = resolvedTheme;
  }
  if (enableColorScheme) {
    root.style.colorScheme = resolvedTheme;
  }
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = THEME_STORAGE_KEY,
  attribute = "class",
  enableSystem = true,
  enableColorScheme = true,
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<Theme>(() => readStoredTheme(storageKey, defaultTheme));
  const [systemTheme, setSystemTheme] = React.useState<ResolvedTheme>(() => getSystemTheme());
  const resolvedTheme = theme === "system" && enableSystem ? systemTheme : theme === "dark" ? "dark" : "light";

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => setSystemTheme(media.matches ? "dark" : "light");
    syncSystemTheme();
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, []);

  React.useEffect(() => {
    applyTheme({ attribute, enableColorScheme, resolvedTheme });
  }, [attribute, enableColorScheme, resolvedTheme]);

  const setTheme = React.useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
    writeThemePreference(nextTheme);
  }, []);

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [resolvedTheme, setTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = React.useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return value;
}
