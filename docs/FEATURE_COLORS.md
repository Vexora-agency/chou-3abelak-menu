# Feature-section colors

Each section in **Admin → Libraries** can carry an optional color. It is a
management aid: the admin list uses it to tell sections apart, while the
customer storefront deliberately stays on one unified brand color.

## Rules

- **Optional.** New sections start with no color. The picker has a **None**
  option; nothing is mandatory.
- **Curated palette.** Gold, amber, orange, red, rose, violet, sky, emerald —
  chosen from swatches, not a free color input, so light/dark contrast stays
  predictable.
- **Admin only.** The color paints the section name pill and the feature-list
  start edge in the Libraries tab. The customer item sheet does **not** read
  it: sizes and add-ons use one unified brand-gold pill, and the heat section
  stays red (the `HeatPill` style).
- **Heat is fixed.** The protected `spicy` section ignores the picker and is
  always red; the admin shows a locked note instead of swatches.
- **Stored optionally.** `FeatureGroup.color?: FeatureColorId` is preserved by
  both server validation and menu normalization. Old docs without a color are
  unchanged; unknown values are dropped (never block a save).

## Files

- `src/types/menu.ts` — `FeatureColorId` + `FeatureGroup.color`.
- `src/utils/featureColors.ts` — palette, pill/swatch classes and the unified
  customer chip classes.
- `functions/_shared/feature-colors.js` — server allowlist + normalizer.
- `functions/_shared/validate-feature-library.js` and
  `functions/_shared/pricing-menu.js` — preserve valid colors.
- `src/utils/pricing-menu.ts` — client normalization preserves valid colors.
- `src/features/admin/components/FeaturesSection.tsx` — picker + colored header.
- `src/features/menu/components/item-view/VariantPicker.tsx`,
  `AddonPicker.tsx` — unified gold option pills.
- `src/features/menu/components/item-view/SpicySlider.tsx` — heat stays red.

## Test

```bash
npm run test:colors
```

It checks the allowlist, validation/normalization preservation, the optional
picker/locked heat rule, and that the customer pickers never read the custom
color.
