# WebMCP (browser agent tools, read-only)

The storefront exposes read-only tools to browser agents through
[WebMCP](https://github.com/webmachinelearning/webmcp) via
`document.modelContext`.

## Packages

- `@w3c/webmcp-polyfill` (runtime): installs `document.modelContext`
  when the browser has no native support. Imported once in
  `src/lib/webmcp.ts` through `@w3c/webmcp-polyfill/auto`.
- `webmcp-types` (dev): TypeScript types, wired in `tsconfig.json`
  (`"types": ["vite/client", "webmcp-types"]`).

## Tools (all `readOnlyHint: true`, never place orders)

- `get-store-info`: name, phone, address, hours, ordering status.
- `list-categories`: visible categories with bilingual names.
- `search-menu`: `{ query, limit? }` search by Arabic or English name,
  returns id, names, category, price range, badges.

Tools fetch `/api/menu` live, work only in secure contexts
(HTTPS or localhost), and unregister on page unload.

## Files

- `src/lib/webmcp.ts`: polyfill import + `initWebMCP()`.
- `src/main.tsx`: calls `initWebMCP()` at startup (never blocks render).
