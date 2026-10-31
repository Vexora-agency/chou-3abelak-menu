import React from 'react';
import type { MenuData } from '@/src/types/menu';
import type { AdminFetch } from '@/src/lib/api-client';
import { featuresConfig } from '@/src/config/features.config';
import { socialOrderOrDefault } from '@/src/utils/settingsDefaults';
import { AnnouncementSection } from '../AnnouncementSection';
import { WorkingHoursSection } from '../WorkingHoursSection';
import { OrderingSection } from '../OrderingSection';
import { IdentitySection } from '../IdentitySection';
import { SocialSection } from '../SocialSection';
import { VisitorDefaultsSection } from '../VisitorDefaultsSection';
import { SmartBadgesSection } from '../SmartBadgesSection';
import { ShowMoreSection } from '../ShowMoreSection';
import { AccessSection } from '../AccessSection';
import { WhatsappApiSection } from '../WhatsappApiSection';
import { TelegramSection } from '../TelegramSection';
import { AutoplaySection } from '../AutoplaySection';
import { FeaturesSection } from '../FeaturesSection';

interface AdminSettingsTabProps {
  menu: MenuData;
  lang: 'en' | 'ar';
  adminFetch: AdminFetch;
  onMenuRefreshed: () => Promise<boolean>;
  onUpdateMenu: (updater: (prev: MenuData) => MenuData) => void;
  collapsedGroups: Record<string, boolean>;
  onToggleCollapse: (gid: string) => void;
  onConfirm: (box: {
    title: string;
    body: string;
    confirmText: string;
    mode?: 'confirm' | 'info';
    action?: () => void;
  }) => void;
}

/** TAB 1: SETTINGS — all storefront section editors. */
export const AdminSettingsTab: React.FC<AdminSettingsTabProps> = ({
  menu, lang, adminFetch, onMenuRefreshed, onUpdateMenu, collapsedGroups, onToggleCollapse, onConfirm,
}) => {
  return (
    <div className="space-y-6 stagger">
      <IdentitySection
        name={menu.settings.name}
        tagline={menu.settings.tagline}
        about={menu.settings.about}
        phone={menu.settings.phone}
        whatsapp={menu.settings.whatsapp}
        mapUrl={menu.settings.mapUrl}
        address={menu.settings.address}
        currency={menu.settings.currency}
        lang={lang}
        onUpdate={(updater) =>
          onUpdateMenu((m) => {
            const s = m.settings;
            const next = updater({
              name: s.name,
              tagline: s.tagline,
              about: s.about,
              phone: s.phone,
              whatsapp: s.whatsapp,
              mapUrl: s.mapUrl,
              address: s.address,
              currency: s.currency,
            });
            return { ...m, settings: { ...m.settings, ...next } };
          })
        }
      />

      <SocialSection
        social={menu.settings.social}
        socialEnabled={menu.settings.socialEnabled}
        lang={lang}
        order={socialOrderOrDefault(menu.settings.socialOrder)}
        whatsappNumber={menu.settings.whatsapp || ''}
        onMove={(key, dir) => {
          const order = socialOrderOrDefault(menu.settings.socialOrder);
          const idx = order.indexOf(key);
          const j = dir === 'up' ? idx - 1 : idx + 1;
          if (idx < 0 || j < 0 || j >= order.length) return;
          const next = [...order];
          const tmp = next[idx];
          next[idx] = next[j];
          next[j] = tmp;
          onUpdateMenu((m) => ({ ...m, settings: { ...m.settings, socialOrder: next } }));
        }}
        onUpdate={(updater) =>
          onUpdateMenu((m) => {
            const next = updater({ social: m.settings.social, socialEnabled: m.settings.socialEnabled });
            return { ...m, settings: { ...m.settings, ...next } };
          })
        }
      />

      <VisitorDefaultsSection
        defaultTheme={menu.settings.defaultTheme}
        defaultLang={menu.settings.defaultLang}
        lang={lang}
        onUpdate={(updater) =>
          onUpdateMenu((m) => {
            const next = updater({ defaultTheme: m.settings.defaultTheme, defaultLang: m.settings.defaultLang });
            return { ...m, settings: { ...m.settings, ...next } };
          })
        }
      />

      <WorkingHoursSection
        statusMode={menu.settings.statusMode}
        openTime={menu.settings.openTime}
        closeTime={menu.settings.closeTime}
        workingDays={menu.settings.workingDays}
        lang={lang}
        onUpdate={(updater) =>
          onUpdateMenu((m) => {
            const next = updater({
              statusMode: m.settings.statusMode,
              openTime: m.settings.openTime,
              closeTime: m.settings.closeTime,
              workingDays: m.settings.workingDays,
            });
            return { ...m, settings: { ...m.settings, ...next } };
          })
        }
      />

      {/* Ordering config lives here on pro; on starter (menu-only) it is
          hidden and the dashboard toggle is the only ordering surface. */}
      {featuresConfig.enableOrdering && (
      <OrderingSection
        ordering={menu.settings.ordering}
        currency={menu.settings.currency.en}
        lang={lang}
        whatsapp={menu.settings.whatsapp || ''}
        adminFetch={adminFetch}
        onMenuRefreshed={onMenuRefreshed}
        onUpdate={(updater) =>
          onUpdateMenu((m) => ({
            ...m,
            settings: { ...m.settings, ordering: updater(m.settings.ordering) },
          }))
        }
      />
      )}

      {featuresConfig.enableOrdering && (
        <WhatsappApiSection lang={lang} adminFetch={adminFetch} />
      )}

      {featuresConfig.enableOrdering && (
        <TelegramSection lang={lang} adminFetch={adminFetch} onConfirm={onConfirm} />
      )}

      {featuresConfig.enableAnnouncements && (
      <AnnouncementSection
        announcement={menu.settings.announcement}
        timezone={menu.settings.timezone || 'Asia/Beirut'}
        lang={lang}
        onUpdate={(updater) =>
          onUpdateMenu((m) => ({
            ...m,
            settings: { ...m.settings, announcement: updater(m.settings.announcement) },
          }))
        }
      />
      )}

      <AutoplaySection
        menu={menu}
        featuredAutoplay={menu.settings.featuredAutoplay}
        featuredAutoplayInterval={menu.settings.featuredAutoplayInterval}
        lang={lang}
        onUpdate={(updater) =>
          onUpdateMenu((m) => {
            const next = updater({ featuredAutoplay: m.settings.featuredAutoplay, featuredAutoplayInterval: m.settings.featuredAutoplayInterval });
            return { ...m, settings: { ...m.settings, ...next } };
          })
        }
      />

      <ShowMoreSection
        menu={menu}
        showMore={menu.settings.showMore}
        lang={lang}
        onUpdate={(updater) =>
          onUpdateMenu((m) => {
            const next = updater({ showMore: m.settings.showMore });
            return { ...m, settings: { ...m.settings, ...next } };
          })
        }
      />

      <FeaturesSection
        menu={menu}
        collapsed={collapsedGroups}
        lang={lang}
        onToggleCollapse={onToggleCollapse}
        onConfirm={onConfirm}
        onDeleteFeatures={(defIds, groupId) =>
          onUpdateMenu((m) => {
            const gone = new Set(defIds);
            const items = m.items.map((it) => {
              const hadSizes = Array.isArray(it.variants) && it.variants.length > 0;
              const variants = (it.variants || []).filter((v) => v && !gone.has(v.featureId));
              const removed = (it.variants || []).filter((v) => v && gone.has(v.featureId));
              const addons = (it.addons || []).filter((a) => a && !gone.has(a.featureId));
              let next = it;
              if (variants.length !== (it.variants || []).length) {
                if (hadSizes && variants.length === 0) {
                  // Lost its only size(s): fall back to a fixed base price
                  // taken from the removed sole size — same amount, no sizes.
                  const fallback = removed.length > 0 && typeof removed[0].price === 'number' ? removed[0].price : undefined;
                  next = {
                    ...next,
                    variants: undefined,
                    defaultVariant: undefined,
                    pricing: { ...it.pricing, ...(fallback !== undefined ? { price: fallback } : {}) },
                  };
                } else {
                  next = { ...next, variants };
                  if (typeof next.defaultVariant === 'string' && gone.has(next.defaultVariant)) {
                    next = { ...next, defaultVariant: variants.length > 0 ? variants[0].featureId : undefined };
                  }
                }
              }
              if (addons.length !== (it.addons || []).length) {
                next = { ...next, addons: addons.length > 0 ? addons : undefined };
              }
              return next;
            });
            return {
              ...m,
              items,
              settings: {
                ...m.settings,
                featureGroups: groupId
                  ? (m.settings.featureGroups || []).filter((g) => g.id !== groupId)
                  : m.settings.featureGroups,
                featureDefs: (m.settings.featureDefs || []).filter((d) => !gone.has(d.id)),
              },
            };
          })
        }
        onUpdate={(updater) =>
          onUpdateMenu((m) => {
            const next = updater({ featureGroups: m.settings.featureGroups, featureDefs: m.settings.featureDefs });
            return { ...m, settings: { ...m.settings, ...next } };
          })
        }
      />

      {/* Smart-badge windows are a pro tuning surface (claimed Pro-only in
          pricing); starter keeps defaults. Same gate as OrderingSection. */}
            {featuresConfig.enableOrdering && (
      <SmartBadgesSection        badges={menu.settings.badges}
        lang={lang}
        onUpdate={(updater) =>
          onUpdateMenu((m) => ({
            ...m,
            settings: { ...m.settings, badges: updater(m.settings.badges) },
          }))
        }
      />
      )}

      {/* Client access: owner-minted invite links (hidden from client logins —
          the section hides itself on 403). Last: it is account-level, not menu. */}
      <AccessSection lang={lang} adminFetch={adminFetch} />
    </div>
  );
};
