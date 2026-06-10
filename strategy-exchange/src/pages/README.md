# pages

Route-level page components.

Pages compose feature components and shared components into full screens. They may own route-level state and navigation decisions, but detailed UI and API logic should stay inside feature modules.

Current page:
- `DashboardPage.tsx`: main strategy exchange page and hash/path route coordinator.
- `LaunchLogicPage.tsx`: route page for launching user strategy logic.
- `MyPage.tsx`: current user profile, active vaults, and saved logic.
- `EditMyPage.tsx`: current user profile edit form.
