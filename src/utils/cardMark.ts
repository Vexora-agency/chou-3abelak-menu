import {
  Pizza,
  Sandwich,
  Drumstick,
  Beef,
  Fish,
  Soup,
  Salad,
  CupSoda,
  Coffee,
  Martini,
  Beer,
  Wine,
  Milk,
  Croissant,
  CakeSlice,
  Donut,
  Cookie,
  IceCreamCone,
  Candy,
  Lollipop,
  Apple,
  Citrus,
  Grape,
  Banana,
  Carrot,
  Leaf,
  Wheat,
  Egg,
  Popcorn,
  UtensilsCrossed,
  ChefHat,
  Flame,
  Sparkles,
  Star,
  Waves,
  Droplets,
  Flower2,
  Shell,
  Feather,
  Rainbow,
  Cloud,
  Snowflake,
  Spline,
  Crown,
  Gem,
  Music,
  Heart,
  Sun,
  Moon,
  Clover,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Brand pan watermark (same asset as the featured carousel). */
export const BRAND_MARK_SRC = '/assets/pan-icon-yellow-336.webp';

/** Default opacity (percent) for watermarks — calm but visible. */
export const DEFAULT_MARK_OPACITY = 18;

/** Default rotation (degrees) for single marks. */
export const DEFAULT_MARK_ROTATE = -12;

export interface CardMarkDef {
  key: string;
  labelEn: string;
  labelAr: string;
  Icon: LucideIcon;
  group: string;
}

export interface CardMarkGroup {
  id: string;
  labelEn: string;
  labelAr: string;
}

export const CARD_MARK_GROUPS: CardMarkGroup[] = [
  { id: 'mains', labelEn: 'Mains', labelAr: 'أطباق رئيسية' },
  { id: 'drinks', labelEn: 'Drinks', labelAr: 'مشروبات' },
  { id: 'bakery', labelEn: 'Bakery & Sweets', labelAr: 'مخبوزات وحلويات' },
  { id: 'fresh', labelEn: 'Fresh', labelAr: 'طازج' },
  { id: 'general', labelEn: 'General', labelAr: 'عام' },
  { id: 'decor', labelEn: 'Decor', labelAr: 'زخارف' },
];

export const CARD_MARKS: CardMarkDef[] = [
  { key: 'pizza', labelEn: 'Pizza', labelAr: 'بيتزا', Icon: Pizza, group: 'mains' },
  { key: 'sandwich', labelEn: 'Sandwich', labelAr: 'ساندويش', Icon: Sandwich, group: 'mains' },
  { key: 'drumstick', labelEn: 'Chicken', labelAr: 'دجاج', Icon: Drumstick, group: 'mains' },
  { key: 'beef', labelEn: 'Meat', labelAr: 'لحم', Icon: Beef, group: 'mains' },
  { key: 'fish', labelEn: 'Fish', labelAr: 'سمك', Icon: Fish, group: 'mains' },
  { key: 'soup', labelEn: 'Soup', labelAr: 'شوربة', Icon: Soup, group: 'mains' },
  { key: 'salad', labelEn: 'Salad', labelAr: 'سلطة', Icon: Salad, group: 'mains' },
  { key: 'cup', labelEn: 'Cup', labelAr: 'كوب', Icon: CupSoda, group: 'drinks' },
  { key: 'coffee', labelEn: 'Coffee', labelAr: 'قهوة', Icon: Coffee, group: 'drinks' },
  { key: 'martini', labelEn: 'Cocktail', labelAr: 'كوكتيل', Icon: Martini, group: 'drinks' },
  { key: 'beer', labelEn: 'Beer', labelAr: 'بيرة', Icon: Beer, group: 'drinks' },
  { key: 'wine', labelEn: 'Juice', labelAr: 'عصير', Icon: Wine, group: 'drinks' },
  { key: 'milk', labelEn: 'Milk', labelAr: 'حليب', Icon: Milk, group: 'drinks' },
  { key: 'croissant', labelEn: 'Croissant', labelAr: 'كرواسون', Icon: Croissant, group: 'bakery' },
  { key: 'cake', labelEn: 'Cake', labelAr: 'كيك', Icon: CakeSlice, group: 'bakery' },
  { key: 'donut', labelEn: 'Donut', labelAr: 'دونات', Icon: Donut, group: 'bakery' },
  { key: 'cookie', labelEn: 'Cookie', labelAr: 'كوكيز', Icon: Cookie, group: 'bakery' },
  { key: 'icecream', labelEn: 'Ice cream', labelAr: 'آيس كريم', Icon: IceCreamCone, group: 'bakery' },
  { key: 'candy', labelEn: 'Candy', labelAr: 'حلوى', Icon: Candy, group: 'bakery' },
  { key: 'lollipop', labelEn: 'Lollipop', labelAr: 'مصاصة', Icon: Lollipop, group: 'bakery' },
  { key: 'apple', labelEn: 'Apple', labelAr: 'تفاح', Icon: Apple, group: 'fresh' },
  { key: 'citrus', labelEn: 'Citrus', labelAr: 'حمضيات', Icon: Citrus, group: 'fresh' },
  { key: 'grape', labelEn: 'Grapes', labelAr: 'عنب', Icon: Grape, group: 'fresh' },
  { key: 'banana', labelEn: 'Banana', labelAr: 'موز', Icon: Banana, group: 'fresh' },
  { key: 'carrot', labelEn: 'Carrot', labelAr: 'جزر', Icon: Carrot, group: 'fresh' },
  { key: 'leaf', labelEn: 'Greens', labelAr: 'خضار', Icon: Leaf, group: 'fresh' },
  { key: 'wheat', labelEn: 'Wheat', labelAr: 'قمح', Icon: Wheat, group: 'fresh' },
  { key: 'egg', labelEn: 'Eggs', labelAr: 'بيض', Icon: Egg, group: 'fresh' },
  { key: 'utensils', labelEn: 'Utensils', labelAr: 'أدوات', Icon: UtensilsCrossed, group: 'general' },
  { key: 'chef', labelEn: 'Chef', labelAr: 'شيف', Icon: ChefHat, group: 'general' },
  { key: 'flame', labelEn: 'Spicy', labelAr: 'حار', Icon: Flame, group: 'general' },
  { key: 'sparkles', labelEn: 'New', labelAr: 'جديد', Icon: Sparkles, group: 'general' },
  { key: 'star', labelEn: 'Star', labelAr: 'نجمة', Icon: Star, group: 'general' },
  { key: 'popcorn', labelEn: 'Popcorn', labelAr: 'فشار', Icon: Popcorn, group: 'general' },
  { key: 'waves', labelEn: 'Waves', labelAr: 'تموجات', Icon: Waves, group: 'decor' },
  { key: 'droplets', labelEn: 'Drops', labelAr: 'قطرات', Icon: Droplets, group: 'decor' },
  { key: 'flower', labelEn: 'Flower', labelAr: 'زهرة', Icon: Flower2, group: 'decor' },
  { key: 'shell', labelEn: 'Shell', labelAr: 'صدفة', Icon: Shell, group: 'decor' },
  { key: 'feather', labelEn: 'Feather', labelAr: 'ريشة', Icon: Feather, group: 'decor' },
  { key: 'rainbow', labelEn: 'Rainbow', labelAr: 'قوس قزح', Icon: Rainbow, group: 'decor' },
  { key: 'cloud', labelEn: 'Cloud', labelAr: 'سحابة', Icon: Cloud, group: 'decor' },
  { key: 'snowflake', labelEn: 'Snow', labelAr: 'ثلج', Icon: Snowflake, group: 'decor' },
  { key: 'spline', labelEn: 'Flow', labelAr: 'انسيابي', Icon: Spline, group: 'decor' },
  { key: 'crown', labelEn: 'Crown', labelAr: 'تاج', Icon: Crown, group: 'decor' },
  { key: 'gem', labelEn: 'Gem', labelAr: 'جوهرة', Icon: Gem, group: 'decor' },
  { key: 'music', labelEn: 'Music', labelAr: 'موسيقى', Icon: Music, group: 'decor' },
  { key: 'heart', labelEn: 'Heart', labelAr: 'قلب', Icon: Heart, group: 'decor' },
  { key: 'sun', labelEn: 'Sun', labelAr: 'شمس', Icon: Sun, group: 'decor' },
  { key: 'moon', labelEn: 'Moon', labelAr: 'قمر', Icon: Moon, group: 'decor' },
  { key: 'clover', labelEn: 'Clover', labelAr: 'برسيم', Icon: Clover, group: 'decor' },
];

export const CARD_MARK_MAP: Record<string, LucideIcon> = Object.fromEntries(
  CARD_MARKS.map((m) => [m.key, m.Icon])
);

export interface CardMarkStyle {
  id: 'corner' | 'center' | 'pattern' | 'cover';
  labelEn: string;
  labelAr: string;
}

export const CARD_MARK_STYLES: CardMarkStyle[] = [
  { id: 'corner', labelEn: 'Corner', labelAr: 'زاوية' },
  { id: 'center', labelEn: 'Center', labelAr: 'وسط' },
  { id: 'pattern', labelEn: 'Pattern', labelAr: 'نمط مكرر' },
  { id: 'cover', labelEn: 'Cover', labelAr: 'تغطية' },
];

export type CardMarkStyleId = 'corner' | 'center' | 'pattern' | 'cover';

export function parseMarkStyle(v: unknown): CardMarkStyleId {
  return v === 'center' || v === 'pattern' || v === 'cover' ? v : 'corner';
}

export type ResolvedMark = { kind: 'img'; src: string } | { kind: 'glyph'; Comp: LucideIcon } | null;

/** Resolve a category's watermark. null = no watermark (clean default,
    same as the original cards). Only an explicit icon opts in. */
export function resolveCategoryMark(icon: unknown, iconUrl: unknown): ResolvedMark {
  if (!icon || icon === 'none') return null;
  if (icon === 'brand') return { kind: 'img', src: BRAND_MARK_SRC };
  if (icon === 'custom') {
    if (typeof iconUrl === 'string' && iconUrl.startsWith('data:image/png;base64,')) {
      return { kind: 'img', src: iconUrl };
    }
    return { kind: 'img', src: BRAND_MARK_SRC };
  }
  if (typeof icon === 'string' && CARD_MARK_MAP[icon]) {
    return { kind: 'glyph', Comp: CARD_MARK_MAP[icon] };
  }
  return null;
}

/** Opacity percent → 0..1 fraction. Clamped to 5..60, default 18. */
export function markOpacity01(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_MARK_OPACITY;
  return Math.min(60, Math.max(5, n)) / 100;
}

/** Size percent → multiplier. Clamped to 25..200, default 100. */
export function markScale01(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 100;
  return Math.min(200, Math.max(25, Math.round(n))) / 100;
}

/** Rotation degrees. Clamped to -180..180, default -12. */
export function markRotate(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_MARK_ROTATE;
  return Math.min(180, Math.max(-180, Math.round(n)));
}

/** Clamp a 0..100 percentage, falling back when invalid. */
function pct(v: unknown, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Mark anchor (%) for single-mark styles. Pattern ignores position. */
export function markPosition(iconX: unknown, iconY: unknown, style: CardMarkStyleId): { x: number; y: number } {
  if (style === 'center' || style === 'cover') {
    return { x: pct(iconX, 50), y: pct(iconY, 50) };
  }
  return { x: pct(iconX, 74), y: pct(iconY, 50) };
}
