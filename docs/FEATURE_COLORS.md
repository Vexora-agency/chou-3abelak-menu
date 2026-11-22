# Feature-library colors

Each section in **Admin → Libraries** and each individual option inside it
can carry an optional color. It is a management aid: the admin list uses it
to tell sections/options apart, while the customer storefront deliberately
stays on one unified brand color.

## Rules

- **Optional.** New sections/options start with no color. Every picker has a
  **None** option; nothing is mandatory.
- **One clean palette.** Only **General colors**: Gold, Amber, Orange, Red,
  Rose, Violet, Sky, Emerald. No Food colors row and no duplicate semantic
  palette.
- **No color names.** Swatches show the color itself; there are no visible
  names or tooltips (a numbered aria-label keeps screen-reader support).
- **Section + option colors.** The section picker paints the section name pill
  and the feature-list start edge. Every feature row (size or add-on) has its
  own picker and a small color dot beside its usage count, so an Add-ons
  section can color cheese, vegetables, etc. independently.
- **Admin only.** The customer item sheet does **not** read section or option
  colors: sizes and add-ons use white/neutral option pills at rest and the
  single brand gold when selected, and the heat
  section stays red (the `HeatPill` style). Selected add-ons also appear beside
  the dish name as compact brand-gold pills (`AddonPill`, same shape as
  `HeatPill`) — never in an admin color.
- **Heat is not locked in admin.** The heat section gets the same optional
  color picker as every other section; its admin color is purely
  organizational, while the customer's heat chip/slider/`HeatPill` stay red.
- **Stored optionally.** `FeatureGroup.color?: FeatureColorId` and
  `FeatureDef.color?: FeatureColorId` are preserved by both server validation
  and menu normalization. Old docs without colors are unchanged; unknown
  values are dropped (never block a save).

## Files

- `src/types/menu.ts` — `FeatureColorId`, `FeatureGroup.color`,
  `FeatureDef.color`.
- `src/utils/featureColors.ts` — the 8-color palette, pill/swatch classes and
  the unified customer chip classes.
- `functions/_shared/feature-colors.js` — server allowlist + normalizer.
- `functions/_shared/validate-feature-library.js` and
  `functions/_shared/pricing-menu.js` — preserve valid section/feature colors.
- `src/utils/pricing-menu.ts` — client normalization preserves valid colors.
- `src/features/admin/components/features/FeatureColorSwatches.tsx` — shared
  swatch row (no names/tooltips).
- `src/features/admin/components/FeaturesSection.tsx` — section picker +
  colored header.
- `src/features/admin/components/features/FeatureRow.tsx` — per-option picker.
- `src/features/menu/components/item-view/VariantPicker.tsx`,
  `AddonPicker.tsx` — white/neutral option pills at rest, solid gold selected.
- `src/components/AddonPill.tsx`, `src/features/menu/components/ItemDetailsModal.tsx`
  — selected add-ons appear beside the dish name as compact unified-gold
  pills (same shape as `HeatPill`; heat stays red).
- `src/features/menu/components/item-view/SpicySlider.tsx` — heat stays red.

## Test

```bash
npm run test:colors
```

It checks the 8-color allowlist, section + feature color preservation in
validation/normalization, the General-colors-only picker, the absence of
color names/tooltips, the per-option picker, and that the customer storefront
never reads an admin color.
