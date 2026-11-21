# Member wishlist

Dishes a signed-in member saves with the heart, stored per account in D1 and
rendered as a third tab in **My account**.

## Behavior

- **Members only.** Guests (and the admin's menu preview, which has no
  provider) see no heart at all — the card layout is unchanged for them.
- **One entry per dish.** Saving is item-level, not variant-level: opening a
  saved dish lets the member pick the size/add-ons fresh.
- **Instant feedback.** The provider flips the heart optimistically, then
  adopts the server's authoritative list. A failed write rolls back only that
  dish and shakes the heart once.
- **Cap.** 200 saved dishes per member; the 201st save returns `409
  wishlist_full` and the client keeps the previous state.
- **Stale menu ids.** Menu content lives in the menu document, not D1. The
  account tab resolves ids against the live menu and silently drops ids that
  no longer exist, so a removed dish never renders a dead row.

## Data model

`migrations/0041_customer_wishlist.sql` (apply **before** deploying the code):

```sql
customer_wishlist (
  user_id   TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  item_id   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item_id)
)
```

`idx_customer_wishlist_user_created` serves newest-first account reads.

## API

`functions/api/account/wishlist.js` — every request is customer-session and
CSRF gated (`X-Requested-With: menu-customer`). The user id comes only from the
session; the client never sends one.

| Method | Path | Body / query | Result |
|---|---|---|---|
| `GET` | `/api/account/wishlist` | — | `{ ok, items, count }` |
| `POST` | `/api/account/wishlist` | `{ itemId }` | authoritative saved list |
| `DELETE` | `/api/account/wishlist?itemId=…` | — | authoritative saved list |

Mutations return the full list so ordering and the count always match the
server without a second request.

SQL lives in `functions/_shared/repositories/wishlist.repo.js`:
`listWishlist`, `countWishlist`, `addWishlistItem` (idempotent),
`removeWishlistItem`, plus `normalizeWishlistItemId`.

## UI surfaces

- `MenuListPhotoCard` — photo cards: heart at the photo's bottom-end, opposite
  the badge and clear of the price tag.
- `MenuListGridCard` — text/photo grid: heart in the badge row.
- `MenuListListRow` — the `list` layout is now a compact horizontal product
  card: a real photo (branded category placeholder on error/missing), name,
  a reserved description slot, and a brand-gold price with a short gold
  underline, with a narrow action column holding the glassy wishlist heart on
  top and an **icon-only** gold add/stepper at the bottom. The list section renders as one centered
  column (`max-w-3xl`) on every breakpoint, matching the owner's compact
  reference. The admin item editor shows the photo field for list items too.
- `MenuListCompactRow` — beside the cart action.
- `MenuListRoundCard` — top-end corner, opposite the badge.
- `FeaturedCarousel` — beside the quick-add button.
- `ItemDetailsModal` — a **bare heart in the sticky header beside Close** (no
  border, circle or background), so it stays visible while options scroll. The
  title is compact and the price moved under it, leaving the top row for the
  heart and close.

`WishlistButton` (`src/features/wishlist/components/WishlistButton.tsx`) has
two shapes: the 44px circular surface/overlay heart on cards and the
chrome-free `bare` heart for the item header. Compact cards use 36×36 with a
44px hit ring. It uses a spring scale + gold fill + eight-particle radial burst
on save, and a quick collapse on remove. Every animation runs for every visitor
by owner decision (no reduced-motion opt-out), matching the rest of the
storefront.

Accessibility and direction:

- `aria-pressed`, plus a dish-specific `aria-label` ("Save X to wishlist" /
  "Remove X from wishlist").
- `stopPropagation` on click/key/pointer so tapping a heart never opens the
  card or the item sheet.
- Logical `start`/`end` utilities and the account sheet's existing
  `dir={isAr ? 'rtl' : 'ltr'}` keep every placement correct in Arabic.
- Light/dark: gold-on-dark and gold-on-cream variants; the glow is built from
  `var(--primary)`, so a client re-skin carries through.

`WishlistProvider` wraps the storefront in `App.tsx` and fetches once per
signed-in user. `useWishlist()` is safe outside the provider (returns the guest
shape), so menu components remain reusable in admin previews.

## Account tab

`AccountSheet` tabs are **My orders · Wishlist · Settings** (`grid-cols-3`).
The wishlist tab shows the saved count, a refresh control, loading skeletons,
an error/retry state, an empty state, and rows with a 64px photo, name,
description/category, live price, options/unavailable hints, and a remove
heart. Tapping a row closes the account sheet and opens the dish in
`ItemDetailsModal` so the member can configure and order it.

## Tests

```bash
npm run test:wishlist   # migration/repo/API/provider/button/tab contracts
npm run test:cart       # address note removal + cart/phone contracts
npm run lint
npm run build
```

The wishlist test also guards that all five menu layouts, the featured
carousel and the item sheet still render the heart, and that the heart is
absent for guests.
