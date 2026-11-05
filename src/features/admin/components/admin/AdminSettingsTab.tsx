import React from 'react';
import type { MenuData } from '@/src/types/menu';
import type { AdminFetch } from '@/src/lib/api-client';
import { featuresConfig } from '@/src/config/features.config';
import { socialOrderOrDefault } from '@/src/utils/settingsDefaults';
import { AnnouncementSection } from '../AnnouncementSection';
import { DeliveryZonesSection } from '../DeliveryZonesSection';
import { WorkingHoursSection } from '../WorkingHoursSection';
import { OrderingSection } from '../OrderingSection';
import { IdentitySection } from '../IdentitySection';
import { SocialSection } from '../SocialSection';
import { VisitorDefaultsSection } from '../VisitorDefaultsSection';
import { SmartBadgesSection } from '../SmartBadgesSection';
import { ShowMoreSection } from '../ShowMoreSection';
import { AccessSection } from '../AccessSection';
import { SentrySection } from '../SentrySection';
import { TelegramSection } from '../TelegramSection';
import { SoundsSection } from '../SoundsSection';
import { NotifyEmailSection } from '../NotifyEmailSection';
import { AutoplaySection } from '../AutoplaySection';

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
        collapsed={!!collapsedGroups['identity']}
        onToggleCollapse={() => onToggleCollapse('identity')}
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
            // Auto-fill Social → WhatsApp from the Identity number: typing
            // the number writes https://wa.me/<digits> into the social field
            // by itself. A hand-typed custom link is never overwritten — only
            // an empty field (or a previous auto-fill from the old number)
            // syncs. Clearing the number clears a previous auto-fill.
            const oldDigits = (s.whatsapp || '').replace(/[^0-9]/g, '');
            const newDigits = (next.whatsapp || '').replace(/[^0-9]/g, '');
            const currentSocial = (s.social?.whatsapp || '').trim();
            const prevAuto = oldDigits ? `https://wa.me/${oldDigits}` : '';
            const nextAuto = newDigits ? `https://wa.me/${newDigits}` : '';
            if (!nextAuto && prevAuto && currentSocial === prevAuto) {
              return {
                ...m,
                settings: { ...m.settings, ...next, social: { ...m.settings.social, whatsapp: '' } },
              };
            }
            if (nextAuto && (!currentSocial || (prevAuto && currentSocial === prevAuto)) && currentSocial !== nextAuto) {
              return {
                ...m,
                settings: { ...m.settings, ...next, social: { ...m.settings.social, whatsapp: nextAuto } },
              };
            }
            return { ...m, settings: { ...m.settings, ...next } };
          })
        }
      />

      <SocialSection
        collapsed={!!collapsedGroups['social']}
        onToggleCollapse={() => onToggleCollapse('social')}
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
        collapsed={!!collapsedGroups['visitor']}
        onToggleCollapse={() => onToggleCollapse('visitor')}
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
        collapsed={!!collapsedGroups['hours']}
        onToggleCollapse={() => onToggleCollapse('hours')}
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
        collapsed={!!collapsedGroups['ordering']}
        onToggleCollapse={() => onToggleCollapse('ordering')}
        ordering={menu.settings.ordering}
        currency={menu.settings.currency[lang] || menu.settings.currency.en}
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
      <DeliveryZonesSection
        collapsed={!!collapsedGroups['delivery-zones']}
        onToggleCollapse={() => onToggleCollapse('delivery-zones')}
        zones={menu.settings.ordering.deliveryZones}
        lang={lang}
        onUpdate={(updater) =>
          onUpdateMenu((m) => ({
            ...m,
            settings: {
              ...m.settings,
              ordering: { ...m.settings.ordering, deliveryZones: updater(m.settings.ordering.deliveryZones) },
            },
          }))
        }
      />
      )}

      {featuresConfig.enableOrdering && (
        <TelegramSection lang={lang} adminFetch={adminFetch} onConfirm={onConfirm} collapsed={!!collapsedGroups['telegram']} onToggleCollapse={() => onToggleCollapse('telegram')} />
      )}

      {featuresConfig.enableOrdering && (
      <NotifyEmailSection
        collapsed={!!collapsedGroups['notify-email']}
        onToggleCollapse={() => onToggleCollapse('notify-email')}
        notifications={menu.settings.notifications ?? { senderName: '', replyTo: '', events: { placed: true, confirmed: true, completed: true, cancelled: true, receipt_check: true } }}
        lang={lang}
        onUpdate={(updater) =>
          onUpdateMenu((m) => ({
            ...m,
            settings: {
              ...m.settings,
              notifications: updater(
                m.settings.notifications ?? { senderName: '', replyTo: '', events: { placed: true, confirmed: true, completed: true, cancelled: true, receipt_check: true } }
              ),
            },
          }))
        }
      />
      )}

      {featuresConfig.enableOrdering && (
      <SoundsSection
        collapsed={!!collapsedGroups['sounds']}
        onToggleCollapse={() => onToggleCollapse('sounds')}
        sounds={menu.settings.sounds}
          lang={lang}
          onUpdate={(updater) =>
            onUpdateMenu((m) => ({
              ...m,
              settings: { ...m.settings, sounds: updater({ sounds: m.settings.sounds }).sounds },
            }))
          }
        />
      )}

      {featuresConfig.enableAnnouncements && (
      <AnnouncementSection
        collapsed={!!collapsedGroups['announcement']}
        onToggleCollapse={() => onToggleCollapse('announcement')}
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
        collapsed={!!collapsedGroups['autoplay']}
        onToggleCollapse={() => onToggleCollapse('autoplay')}
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
        collapsed={!!collapsedGroups['showmore']}
        onToggleCollapse={() => onToggleCollapse('showmore')}
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

      {/* Smart-badge windows are a pro tuning surface (claimed Pro-only in
          pricing); starter keeps defaults. Same gate as OrderingSection. */}
            {featuresConfig.enableOrdering && (
      <SmartBadgesSection        badges={menu.settings.badges}
        collapsed={!!collapsedGroups['badges']}
        onToggleCollapse={() => onToggleCollapse('badges')}
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
      <AccessSection lang={lang} adminFetch={adminFetch} collapsed={!!collapsedGroups['access']} onToggleCollapse={() => onToggleCollapse('access')} />

      {/* Error monitoring (Sentry) diagnostics: owner-only, same 403-hide
          rule as AccessSection — client logins never see this. */}
      <SentrySection lang={lang} adminFetch={adminFetch} collapsed={!!collapsedGroups['sentry']} onToggleCollapse={() => onToggleCollapse('sentry')} />
    </div>
  );
};
