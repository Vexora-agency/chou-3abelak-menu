import type { CartLine, MenuItem } from '@/src/types/menu';

export function useMenuListCartQuantities(cart: Record<string, CartLine>): {
  linesOf: (item: MenuItem) => Array<[string, CartLine]>;
  totalQtyOf: (item: MenuItem) => number;
} {
  // Lines of one item + helpers (option items route through the details sheet)
  const linesOf = (item: MenuItem) =>
    Object.entries(cart).filter(([, l]) => l.id === item.id);
  const totalQtyOf = (item: MenuItem) =>
    linesOf(item).reduce((s, [, l]) => s + l.quantity, 0);

  return { linesOf, totalQtyOf };
}
