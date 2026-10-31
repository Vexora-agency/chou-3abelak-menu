// Unit tests for ensureSettingsBlocks (src/utils/menuHelpers.ts).
// Guards the admin Settings tab against old/seed docs that lack the
// announcement + privacy blocks (reading them unguarded crashes render).
// Run: npx tsx scripts/test-settings-defaults.ts
import { ensureSettingsBlocks, formatHoursRange, formatTime12h, isOpenNow } from '../src/utils/menuHelpers';
import type { MenuData } from '../src/types/menu';

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string): void {
  if (cond) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}`);
  }
}

const baseMenu = (settings: unknown): MenuData => ({
  version: 2,
  schemaVersion: 2,
  updatedAt: '2026-01-01T00:00:00.000Z',
  settings: settings as unknown as MenuData['settings'],
  categories: [],
  items: [],
});

// 1. Missing blocks get safe defaults (the seed case that crashed Settings).
{
  const out = ensureSettingsBlocks(baseMenu({}));
  ok(out.settings.announcement.enabled === false, 'announcement disabled by default');
  ok(out.settings.announcement.text.en === '' && out.settings.announcement.text.ar === '', 'announcement text empty by default');
  ok(out.settings.announcement.startsAt === null && out.settings.announcement.expiresAt === null, 'announcement dates null by default');
  ok(out.settings.announcement.scroll === true, 'announcement scrolls by default');
  ok(out.settings.announcement.speed === 5, 'announcement speed defaults to 5');
  ok(out.settings.privacy.reviewed === false, 'privacy unreviewed by default');
  ok(out.settings.privacy.extra.en === '' && out.settings.privacy.extra.ar === '', 'privacy notes empty by default');
}

// 2. Partial blocks keep what exists, fill the rest.
{
  const out = ensureSettingsBlocks(
    baseMenu({ announcement: { enabled: true, text: { en: 'Hi' } }, privacy: { reviewed: true } })
  );
  ok(out.settings.announcement.enabled === true, 'keeps enabled flag');
  ok(out.settings.announcement.text.en === 'Hi', 'keeps existing text');
  ok(out.settings.announcement.text.ar === '', 'fills missing language');
  ok(out.settings.privacy.reviewed === true, 'keeps reviewed flag');
}

// 3. Full values pass through untouched (incl. scroll/speed tuning).
{
  const out = ensureSettingsBlocks(
    baseMenu({
      announcement: {
        enabled: true,
        text: { en: 'A', ar: 'ب' },
        startsAt: '2026-01-01T00:00:00.000Z',
        expiresAt: null,
        scroll: false,
        speed: 9,
      },
      privacy: { extra: { en: 'x', ar: 'ي' }, reviewed: true },
    })
  );
  ok(out.settings.announcement.scroll === false, 'keeps scroll=false');
  ok(out.settings.announcement.speed === 9, 'keeps tuned speed');
  ok(out.settings.announcement.startsAt === '2026-01-01T00:00:00.000Z', 'keeps startsAt');
  ok(out.settings.privacy.extra.en === 'x', 'keeps privacy notes');
}

// 4. Out-of-range / mistyped values are clamped, never trusted blindly.
{
  const out = ensureSettingsBlocks(baseMenu({ announcement: { speed: 99, scroll: 'yes', text: { en: 7 } } }));
  ok(out.settings.announcement.speed === 10, 'speed clamped to 10');
  const out2 = ensureSettingsBlocks(baseMenu({ announcement: { speed: 0 } }));
  ok(out2.settings.announcement.speed === 1, 'speed clamped to 1');
  ok(out.settings.announcement.text.en === '', 'non-string text dropped');
  ok(out.settings.announcement.scroll === true, 'non-boolean scroll falls back to true');
}

// 5b. Bell chimes default to classic, keep valid ids, drop bogus ones.
{
  const out = ensureSettingsBlocks(baseMenu({}));
  ok(out.settings.sounds.kitchen === 'classic' && out.settings.sounds.customer === 'classic', 'sounds default to classic');
  const kept = ensureSettingsBlocks(baseMenu({ sounds: { kitchen: 'gong', customer: 'soft' } }));
  ok(kept.settings.sounds.kitchen === 'gong' && kept.settings.sounds.customer === 'soft', 'sounds keep valid ids');
  const bad = ensureSettingsBlocks(baseMenu({ sounds: { kitchen: 'hack', customer: 7 } }));
  ok(bad.settings.sounds.kitchen === 'classic' && bad.settings.sounds.customer === 'classic', 'sounds reject bogus ids');
}

// 5. Input is never mutated.
{
  const settings = {};
  const menu = baseMenu(settings);
  ensureSettingsBlocks(menu);
  ok(!('announcement' in (settings as object)), 'input settings untouched');
}

// 6. Show-more paging defaults, keeps and clamps (mirrors server validate).
{
  const out = ensureSettingsBlocks(baseMenu({}));
  ok(out.settings.showMore.initial === 12 && out.settings.showMore.batch === 8, 'showMore defaults 12/8');
  const kept = ensureSettingsBlocks(baseMenu({ showMore: { initial: 20, batch: 6 } }));
  ok(kept.settings.showMore.initial === 20 && kept.settings.showMore.batch === 6, 'showMore keeps tuned values');
  const clamped = ensureSettingsBlocks(baseMenu({ showMore: { initial: 2, batch: 99 } }));
  ok(clamped.settings.showMore.initial === 12 && clamped.settings.showMore.batch === 8, 'showMore out-of-range falls back');
}

// 7. Hours display is derived from the real schedule, never static text.
{
  ok(formatTime12h('13:05', 'en') === '1:05 PM', '12h en pm');
  ok(formatTime12h('13:05', 'ar') === '1:05 مساءً', '12h ar pm');
  ok(formatTime12h('00:00', 'en') === '12:00 AM', 'midnight en');
  const sched = (o: unknown) => o as unknown as MenuData['settings'];
  const all = sched({ openTime: '09:00', closeTime: '22:00', workingDays: ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] });
  ok(formatHoursRange(all, 'en') === 'Daily · 9:00 AM – 10:00 PM', 'range en all-days');
  ok(formatHoursRange(all, 'ar') === 'يومياً · من 9:00 صباحاً إلى 10:00 مساءً', 'range ar all-days');
  const some = sched({ openTime: '12:00', closeTime: '00:00', workingDays: ['sat', 'sun'] });
  ok(formatHoursRange(some, 'en').includes('Sat') && formatHoursRange(some, 'en').includes('12:00 PM'), 'range en subset days');
  // The storefront pill mirrors the edited schedule (the reported bug:
  // changing open/close left "Daily · 12:00 PM – 12:00 AM" frozen).
  const st = isOpenNow({ ...all, statusMode: 'open' } as unknown as MenuData['settings']);
  ok(st.isOpen === true && st.label.en.includes('9:00 AM') && st.label.en.includes('10:00 PM'), 'open pill follows edited hours');
  ok(st.label.ar.includes('9:00 صباحاً') && st.label.ar.includes('10:00 مساءً'), 'open pill ar follows edited hours');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
