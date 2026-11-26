/**
 * Member wishlist — runnable contract checks.
 * Run: node scripts/test-wishlist.mjs
 *
 * Proves the parts that keep the feature safe and consistent:
 *  - the table is per-user, item-level, cascade-deleted, newest-first;
 *  - the API is session + CSRF gated and never trusts a client user id;
 *  - mutations are idempotent and bounded;
 *  - every menu layout and the item sheet expose the heart;
 *  - the account sheet has a real Wishlist tab (3 tabs, RTL safe);
 *  - guests (and admin previews without a provider) see no hearts;
 *  - the provider flips optimistically, rolls back on failure, and adopts
 *    the server's authoritative list.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_WISHLIST_ITEMS,
  normalizeWishlistItemId,
} from '../functions/_shared/repositories/wishlist.repo.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');
const has = (source, ...needles) => needles.every((needle) => source.includes(needle));

let fails = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok ${name}`);
  else {
    fails++;
    console.error(`  FAIL ${name}`);
  }
};

/* ---------- migration ---------- */

const migration = read('migrations/0041_customer_wishlist.sql');
check(
  'wishlist table exists with a per-user/item primary key',
  has(migration, 'CREATE TABLE IF NOT EXISTS customer_wishlist', 'PRIMARY KEY (user_id, item_id)')
);
check(
  'wishlist rows cascade with the member account',
  has(migration, 'FOREIGN KEY (user_id) REFERENCES "user" ("id") ON DELETE CASCADE')
);
check(
  'wishlist reads are newest-first',
  has(migration, 'CREATE INDEX IF NOT EXISTS idx_customer_wishlist_user_created', 'created_at DESC')
);

/* ---------- repository ---------- */

const repo = read('functions/_shared/repositories/wishlist.repo.js');
check(
  'every wishlist query is scoped by the session user id',
  (repo.match(/WHERE user_id = \?1/g) || []).length >= 3 && has(repo, 'WHERE user_id = ?1', 'AND item_id = ?2')
);
check(
  'saving is idempotent and never reorders an existing row',
  has(repo, 'ON CONFLICT(user_id, item_id) DO NOTHING', "if (existing) return { ok: true, added: false }")
);
check(
  'the wishlist is capped per member',
  MAX_WISHLIST_ITEMS === 200 && has(repo, 'count >= MAX_WISHLIST_ITEMS', "reason: 'full'")
);
check(
  'item ids are trimmed and bounded, never guessed',
  normalizeWishlistItemId('  item-1  ') === 'item-1'
    && normalizeWishlistItemId('') === ''
    && normalizeWishlistItemId('   ') === ''
    && normalizeWishlistItemId('x'.repeat(81)) === ''
    && normalizeWishlistItemId('bad\u0000id') === ''
    && normalizeWishlistItemId('Case-Sensitive_1') === 'Case-Sensitive_1'
);
check(
  'removing an item deletes exactly one member item',
  has(repo, "DELETE FROM customer_wishlist WHERE user_id = ?1 AND item_id = ?2")
);

/* ---------- route ---------- */

const route = read('functions/api/account/wishlist.js');
check(
  'wishlist API is session + customer-CSRF gated',
  has(route, 'checkCustomerApiHeaders(request)', 'requireCustomer(request, env)', 'gate.error', 'auth.response')
);
check(
  'wishlist API supports read, save and remove',
  has(route, "request.method !== 'GET'", "request.method !== 'POST'", "request.method !== 'DELETE'")
);
check(
  'the user id always comes from the session, never the body',
  has(route, 'auth.user.id') && !route.includes('body.userId') && !route.includes('body.user_id')
);
check(
  'save/remove return the authoritative saved list',
  has(route, 'savedPayload(await listWishlist(db, auth.user.id))', 'items, count: items.length')
);
check(
  'a full wishlist is a clear 409, invalid ids are a 400',
  has(route, "error: 'wishlist_full'", '409', "error: 'invalid_item'", '400')
);

/* ---------- client API + provider ---------- */

const api = read('src/features/wishlist/services/wishlist.api.ts');
check(
  'client calls carry the customer CSRF header and the item id',
  has(api, "'X-Requested-With': 'menu-customer'", '/api/account/wishlist', 'JSON.stringify({ itemId })', 'encodeURIComponent(itemId)')
);

const provider = read('src/features/wishlist/context/WishlistContext.tsx');
check(
  'the provider is member-aware and safe without a provider',
  has(provider, 'useCustomerSession()', 'isMember', 'EMPTY_WISHLIST', "isMember: false")
);
check(
  'the provider re-fetches when the signed-in member changes',
  has(provider, '}, [userId, version]);', 'if (!userId)', 'setEntries([])')
);
check(
  'toggling is optimistic and rolls back only the failed item',
  has(provider, 'setEntries((prev) =>', 'wasSaved', 'activeUserRef.current', 'pendingRef.current')
);
check(
  'the server list is adopted after every mutation',
  has(provider, 'const server = data.items', 'return server', 'pendingRef.current.size <= 1')
);

/* ---------- heart component ---------- */

const button = read('src/features/wishlist/components/WishlistButton.tsx');
check(
  'the heart is hidden for guests/admin previews',
  has(button, 'if (!isMember) return null')
);
check(
  'the heart is a real pressed-state button with a specific label',
  has(button, 'aria-pressed={saved}', 'aria-label={label}', 'data-wishlist-saved', 'itemName')
);
check(
  'the heart never opens the card underneath',
  has(button, 'event.stopPropagation()', 'onKeyDown={(event) => event.stopPropagation()}')
);
check(
  'the tap runs a spring + radial particle burst',
  has(button, 'motion.span', 'scale: [1, 1.38, 0.9, 1]', 'PARTICLES.map', 'ring-', 'transition={{ duration: 0.48')
);
check(
  'the heart uses theme gold, not a hard-coded brand hex',
  has(button, 'var(--primary)', 'wishlist-heart-glow') && !button.includes('#FFC400')
);
check(
  'the bare header heart uses the black/gold brand in light mode',
  has(button, "text-[#0A0A0A] hover:bg-black/[0.05]", "fill={saved ? (isBare && !darkMode ? 'var(--primary)'", "stroke={isBare && !darkMode ? '#0A0A0A'")
);

/* ---------- every menu surface ---------- */

const surfaces = [
  'src/features/menu/components/menu-list/MenuListPhotoCard.tsx',
  'src/features/menu/components/menu-list/MenuListGridCard.tsx',
  'src/features/menu/components/menu-list/MenuListListRow.tsx',
  'src/features/menu/components/menu-list/MenuListWaveRow.tsx',
  'src/features/menu/components/menu-list/MenuListRoundCard.tsx',
  'src/features/menu/components/FeaturedCarousel.tsx',
  'src/features/menu/components/ItemDetailsModal.tsx',
];
for (const path of surfaces) {
  const source = read(path);
  check(`${path.split('/').pop()} renders the member heart`, has(source, 'WishlistButton', 'itemId={item.id}'));
}
const itemModal = read('src/features/menu/components/ItemDetailsModal.tsx');
check(
  'the item sheet puts a bare heart at the top beside Close',
  has(itemModal, 'variant="bare"', 'size="md"', 'aria-label={isAr ? \'إغلاق\' : \'Close modal\'}')
    && !itemModal.includes('ms-auto')
    && !itemModal.includes('size="lg"')
);
check(
  'the item title is compact and the price sits under it',
  has(itemModal, 'text-[15px] min-[380px]:text-lg sm:text-xl', 'ref={headerPriceRef}', 'mt-1.5 flex flex-wrap items-center gap-1.5')
);
check(
  'the item sheet has no bottom save pill (save lives in the header)',
  !itemModal.includes('variant="pill"')
);
check(
  'the round card heart sits opposite the badge in logical end space',
  has(read('src/features/menu/components/menu-list/MenuListRoundCard.tsx'), 'absolute -top-1 end-0', 'WishlistButton')
);

/* ---------- compact list layout (photo cards) ---------- */

const listCard = read('src/features/menu/components/menu-list/MenuListListRow.tsx');
check(
  'the list layout supports dish photos with a branded fallback',
  has(listCard, 'SmartMenuImage', 'photo-placeholder', 'sectionMark', 'failedSrc')
);
check(
  'the list card actions are icon-only: glassy heart + vertical add/stepper',
  has(listCard, 'variant="icon"', 'tone="overlay"', 'layout="vertical"', 'w-12 sm:w-[54px]', 'justify-between')
    && !listCard.includes('أضف للسلة')
);
check(
  'the list card keeps a small text-to-price gap and shrinks long copy',
  has(listCard, 'name.length > 38', 'priceText.length > 13', 'mt-1.5 font-black', 'text-[#0A0A0A]')
    && !listCard.includes('min-h-[2.6em]')
);
check(
  'the list badge sits inside the card edge (never clipped)',
  has(listCard, 'absolute top-1 start-2', 'z-20')
);
const listAction = read('src/features/menu/components/menu-list/MenuListItemAction.tsx');
check(
  'the list add control is icon-only with a vertical stepper',
  has(listAction, "layout?: 'horizontal' | 'vertical'", 'renderVerticalStepper', 'w-12 h-12 rounded-2xl', 'addIcon = vertical ? 20')
    && !listAction.includes('أضف للسلة')
);
const menuListSource = read('src/features/menu/components/MenuList.tsx');
check(
  'the list section is responsive: 1 / 2 / 3 columns',
  has(
    menuListSource,
    "if (kind === 'list') return mq(1280) ? 3 : mq(768) ? 2 : 1;",
    'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
    'max-w-3xl md:max-w-5xl xl:max-w-7xl'
  )
);
const itemEdit = read('src/features/admin/components/ItemEditModal.tsx');
check(
  'the admin shows the photo field for list items',
  has(itemEdit, "catLayout === 'list'", 'photoRelevant')
);
const cropEditor = read('src/features/admin/components/item-editor/ImageCropEditor.tsx');
const imageField = read('src/features/admin/components/item-editor/ItemImageField.tsx');
check(
  'round categories get a square crop with a circular guide and preview',
  has(cropEditor, 'round?: boolean', 'aspect-square', 'rounded-full border-2 border-white/85')
    && has(imageField, 'roundCrop?: boolean', 'aspect-square', 'rounded-full ring-1 ring-white/15')
    && has(itemEdit, "roundCrop={catLayout === 'round'}")
);
const categoriesTab = read('src/features/admin/components/CategoriesTab.tsx');
check(
  'the admin style hints are short and cover every layout',
  has(categoriesTab, 'Large photo-first cards', 'Photo background with a readable scrim', 'Photo beside the name and price', 'Alternating soft-wave bands', 'Round photo in a gold ring', 'Waves')
);

/* ---------- account sheet ---------- */

const account = read('src/features/auth/components/AccountSheet.tsx');
check(
  'the account sheet has exactly three tabs: orders, wishlist, settings',
  has(account, "type Tab = 'orders' | 'wishlist' | 'settings'", "(['orders', 'wishlist', 'settings'] as const)", 'grid-cols-3')
);
check(
  'the wishlist tab resolves saved ids against the live menu',
  has(account, 'const wishlist = useWishlist()', 'new Map(menu.items.map', 'filter((menuItem): menuItem is MenuItem => !!menuItem)')
);
check(
  'saved dishes render with photo, name, price and a remove heart',
  has(account, '<SmartMenuImage', 'priceLabel(item, lang, currency, menu)', '<WishlistButton')
);
check(
  'the wishlist tab has loading, error, empty and list states',
  has(account, 'wishlist.loading && wishlistItems.length === 0', 'wishlist.error', 't.wishlistEmpty', 'wishlistItems.map')
);
check(
  'tapping a saved dish closes the sheet and opens the item',
  has(account, 'onClose();', 'onOpenItem?.(menuItem)')
);
check(
  'the sheet is direction-aware (RTL)',
  has(account, "dir={isAr ? 'rtl' : 'ltr'}")
);

/* ---------- app wiring + strings ---------- */

const app = read('src/App.tsx');
check(
  'the storefront mounts the provider and passes the menu to the account sheet',
  has(app, '<WishlistProvider>', 'menu={displayMenu}', 'onOpenItem={setActiveItem}')
);
const strings = read('src/features/auth/strings.ts');
check(
  'wishlist copy exists in English and Arabic',
  has(strings, "wishlist: 'Wishlist'", "wishlist: 'المفضلة'", "wishlistTitle: 'Saved for later'", "wishlistTitle: 'محفوظة لوقت لاحق'")
);
const wishlistStrings = read('src/features/wishlist/strings.ts');
check(
  'the heart labels are bilingual',
  has(wishlistStrings, 'Save ${name} to wishlist', 'احفظ ${name} في المفضلة', 'Remove ${name} from wishlist', 'أزل ${name} من المفضلة')
);

/* ---------- result ---------- */

if (fails > 0) {
  console.error(`\nFAIL — ${fails} assertion(s) failed`);
  process.exit(1);
}
console.log('\nPASS — member wishlist contract holds');
