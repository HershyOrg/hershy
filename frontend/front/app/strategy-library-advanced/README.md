# Strategy Library Advanced Workbench

This folder isolates the Strategy Library advanced-view UI so it can be edited without touching the full home workspace.

- Route: `/strategy-library-advanced`
- Main component: `StrategyLibraryAdvancedWorkbench.tsx`
- Uses the existing `NodeEditor` and advanced graph styles from the app.
- Reads saved strategy history from `historyStore`; if no history exists, it shows local demo advanced graphs.

The original `components/home/StrategyLibraryWorkspace.tsx` is unchanged.
