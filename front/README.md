# front

A plain Vite + React frontend app.

- `npm run dev`: Starts the Vite development server.
- `npm run build`: Runs TypeScript checks and the Vite production build.
- `npm run start`: Previews the build output with Vite preview.

The app currently does not use `/api/*` server routes. Screen data comes from the frontend dummy API in `src/shared/api/dummyApi.ts`. When connecting a backend, replace the functions in that file with a real HTTP client implementation.
