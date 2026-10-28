# Pricing Engine — Single Source of Truth

**Source:** `src/utils/pricing*.ts` (TypeScript)
**Mirror:** `functions/_shared/pricing*.js` (JavaScript) — MUST stay behavior-identical.

## Rule

Always edit `src/utils/pricing*.ts` FIRST, then copy the logic into
`functions/_shared/pricing*.js` (adapting only types → runtime checks),
then run the parity test:

```bash
npm run test:parity   # 82 fixtures through BOTH implementations, fails on drift
```

If you fix a bug, fix it in BOTH places and run `test:parity`.
The mirror exists because Cloudflare Pages Functions run plain JS
(no TS transform on the server path) — do NOT delete the JS copy.

## File pairs

| Source (truth) | Mirror | Status |
|---|---|---|
| `src/utils/pricing.ts` (264 lines) | `functions/_shared/pricing.js` (233 lines) | Identical logic; TS-only display helpers (`priceLabel`, `lineMathText`) intentionally have no server copy |
| `src/utils/pricing-menu.ts` (302 lines) | `functions/_shared/pricing-menu.js` (212 lines) | Money paths identical; server `normalizeMenu` covers an intentional subset (see below) |
| `src/utils/pricing-badges.ts` (81 lines) | `functions/_shared/pricing-badges.js` (64 lines) | Identical (line delta is types only) |
| `src/utils/status.ts` | `functions/_shared/status.js` | NOT duplicated — client imports the server implementation directly. No parity needed. Model for future dedup. |
| `src/utils/menuValidation.ts` | `functions/_shared/validate*.js` | NOT a mirror — light client pre-check vs normative server enforcement. Different purposes by design. |

## Known intentional gaps (not drift)

1. **Server `normalizeMenu` skips display settings.** The TS version also
   normalizes `statusMode/openTime/social/about/currency/announcement/privacy`
   via `settingsDefaults`; the JS version only normalizes what order
   validation needs (ordering flags, badges, feature library, items).
   The parity test compares the money-relevant subset
   (`items`, `featureDefs/Groups`, `ordering` min/fee/enabled, `badges`,
   `schemaVersion`). If the server ever needs display fields, extend the
   JS copy AND the parity test together.
2. **`priceLabel` / `lineMathText` are client-only** (storefront display).
   The server never formats prices for display.
3. **Zero-price variants are accepted by both sides** (`unitPrice` throws
   only on missing/negative/non-numeric). Note: `scripts/test-pricing.mjs`
   contains one stale expectation (`zero variant price rejected did not
   throw`) that contradicts BOTH implementations — the test is outdated,
   the code agrees. Fix the test expectation, not the engines.

## Future

If the mirror keeps causing work, consider generating the JS from TS
(simple transpile step) or moving shared pure logic to a single `.js`
module imported by both (the `status.js` pattern). Until then, the parity
test is the drift guard — keep it in CI.
