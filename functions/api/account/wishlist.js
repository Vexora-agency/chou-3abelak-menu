/**
 * GET/POST/DELETE /api/account/wishlist
 *
 * The signed-in member's saved menu items. Every query is scoped by the
 * session user id; the client never supplies a user id.
 *
 * - GET    → { ok, items: [{ itemId, createdAt }], count }
 * - POST   → { itemId } saves one item (idempotent)
 * - DELETE ?itemId=… removes one item
 *
 * Mutations return the full, authoritative saved list so the client can
 * adopt the server's order/count without a second request.
 */

import { jsonNoStore, readJsonBody } from '../../_shared/session.js';
import { checkCustomerApiHeaders, requireCustomer } from '../../_shared/auth-session.js';
import {
  addWishlistItem,
  listWishlist,
  removeWishlistItem,
} from '../../_shared/repositories/wishlist.repo.js';

function savedPayload(items) {
  return { ok: true, items, count: items.length };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'DELETE') {
    return jsonNoStore({ error: 'method_not_allowed' }, 405, { Allow: 'GET, POST, DELETE' });
  }

  const gate = checkCustomerApiHeaders(request);
  if (!gate.ok) return jsonNoStore({ error: gate.error, message: gate.message }, gate.status);

  const auth = await requireCustomer(request, env);
  if (!auth.ok) return auth.response;

  const db = env.ORDERS_DB || null;
  if (!db) return jsonNoStore({ error: 'unavailable' }, 503);

  try {
    if (request.method === 'GET') {
      return jsonNoStore(savedPayload(await listWishlist(db, auth.user.id)));
    }

    let itemId = '';
    if (request.method === 'DELETE') {
      itemId = new URL(request.url).searchParams.get('itemId') || '';
    } else {
      let body;
      try {
        body = await readJsonBody(request, 2 * 1024);
      } catch {
        return jsonNoStore({ error: 'bad_request' }, 400);
      }
      itemId = body && typeof body.itemId === 'string' ? body.itemId : '';
    }

    if (!itemId.trim() || itemId.length > 80) {
      return jsonNoStore({ error: 'invalid_item' }, 400);
    }

    if (request.method === 'POST') {
      const result = await addWishlistItem(db, auth.user.id, itemId, new Date().toISOString());
      if (!result.ok) {
        if (result.reason === 'invalid') return jsonNoStore({ error: 'invalid_item' }, 400);
        if (result.reason === 'full') {
          return jsonNoStore({
            error: 'wishlist_full',
            message: {
              en: 'Your wishlist is full. Remove an item to save another.',
              ar: 'قائمة المفضلة ممتلئة. احذف عنصرًا لحفظ عنصر آخر.',
            },
          }, 409);
        }
        return jsonNoStore({ error: 'unavailable' }, 503);
      }
    } else {
      const result = await removeWishlistItem(db, auth.user.id, itemId);
      if (!result.ok) return jsonNoStore({ error: 'invalid_item' }, 400);
    }

    return jsonNoStore(savedPayload(await listWishlist(db, auth.user.id)));
  } catch {
    return jsonNoStore({ error: 'unavailable' }, 503);
  }
}
