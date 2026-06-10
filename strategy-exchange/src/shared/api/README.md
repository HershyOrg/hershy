# shared/api

Generic API helpers.

Put fetch wrappers, request helpers, response parsing, auth headers, retry helpers, and transport-level code here.

Do not put endpoint-specific strategy exchange calls here. Those belong in `features/strategy-exchange/api/`.

Current behavior:
- Uses relative mock API paths during local development.
- Uses `VITE_API_BASE_URL` when a real backend URL is configured.
- Throws `ApiRequestError` for failed requests.
- Can validate response envelopes with zod schemas before returning data.
