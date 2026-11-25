import React from 'react';
import type { MenuData } from '@/src/types/menu';
import type { AdminFetch } from '@/src/lib/api-client';
import { featuresConfig } from '@/src/config/features.config';
import { socialOrderOrDefault } from '@/src/utils/settingsDefaults';
import { Store, ShoppingBag, BellRing, LayoutGrid, ShieldCheck, Users, CreditCard } from 'lucide-react';
import { SettingsGroupBody, SettingsGroupHeader } from '../SettingsCollapsible';
import { AnnouncementSection } from '../AnnouncementSection';
import { DeliveryZonesSection } from '../DeliveryZonesSection';
import { WorkingHoursSection } from '../WorkingHoursSection';
import { OrderingSection } from '../OrderingSection';
import { IdentitySection } from '../IdentitySection';
import { SocialSection } from '../SocialSection';
import { VisitorDefaultsSection } from '../VisitorDefaultsSection';
import { SmartBadgesSection } from '../SmartBadgesSection';
import { ShowMoreSection } from '../ShowMoreSection';
import { ImageRecompressSection } from '../ImageRecompressSection';
import { AccessSection } from '../AccessSection';
import { TeamAccessSection } from '../TeamAccessSection';
import { SentrySection } from '../SentrySection';
import { TelegramSection } from '../TelegramSection';
import { PaymentsSection } from '../PaymentsSection';
import { SoundsSection } from '../SoundsSection';
import { NotifyEmailSection } from '../NotifyEmailSection';
import { AutoplaySection } from '../AutoplaySection';
import { SeasonalSection } from '../SeasonalSection';

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
  /** Owner signal (master login). When false (client login) the whole
      Access & Diagnostics group is skipped — its children would self-hide
      on 403 anyway, but that would leave an empty shell. Null/undefined
      (still checking) renders everything: fail-open, sections self-hide
      on 403. This fixes the group vanishing on every refresh while the
      versions check is in flight. */
  isOwner?: boolean | null;
}

/**
 * Parent settings group: a collapsible card that nests whole section cards
 * unchanged inside it. Open by default (absent key = open, same rule as the
 * child sections in AdminPanel) and persisted via the same collapsedGroups
 * map — child section keys are untouched.
 */
const SettingsParentGroup: React.FC<{
  groupKey: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  lang: 'en' | 'ar';
  collapsedGroups: Record<string, boolean>;
  onToggleCollapse: (gid: string) => void;
  children: React.ReactNode;
}> = ({ groupKey, title, subtitle, icon, lang, collapsedGroups, onToggleCollapse, children }) => {
  const collapsed = !!collapsedGroups[groupKey];
  return (
    <div className="rounded-2xl border border-neutral-700 bg-black/40 p-3 sm:p-4">
      <SettingsGroupHeader
        title={title}
        subtitle={subtitle}
        lang={lang}
        collapsed={collapsed}
        onToggle={() => onToggleCollapse(groupKey)}
        action={
          <span className="shrink-0 w-9 h-9 rounded-xl bg-[var(--primary)]/10 border border-[var(--primary)]/30 text-[var(--primary)] flex items-center justify-center">
            {icon}
          </span>
        }
      />
      <SettingsGroupBody open={!collapsed}>{children}</SettingsGroupBody>
    </div>
  );
};

/** TAB 1: SETTINGS — all storefront section editors, nested in 5 parent groups. */
export const AdminSettingsTab: React.FC<AdminSettingsTabProps> = ({
  menu, lang, adminFetch, onMenuRefreshed, onUpdateMenu, collapsedGroups, onToggleCollapse, onConfirm, isOwner,
}) => {
  const isAr = lang === 'ar';
  return (
    <div className="space-y-6 stagger">
      {/* 1. Brand & Contact — الهوية والتواصل */}
      <SettingsParentGroup
        groupKey="grp-brand"
        title={isAr ? 'الهوية والتواصل' : 'Brand & Contact'}
        subtitle={isAr ? 'اسم المطعم ومعلومات التواصل وحسابات التواصل' : 'Name, contact info and social links'}
        icon={<Store size={18} />}
        lang={lang}
        collapsedGroups={collapsedGroups}
        onToggleCollapse={onToggleCollapse}
      >
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
      </SettingsParentGroup>

      {/* 2. Ordering — الطلبات. Ordering config lives here on pro; on
          starter (menu-only) it is hidden and the dashboard toggle is the
          only ordering surface. */}
      {featuresConfig.enableOrdering && (
        <SettingsParentGroup
          groupKey="grp-ordering"
          title={isAr ? 'الطلبات' : 'Ordering'}
          subtitle={isAr ? 'نظام الطلبات ومناطق التوصيل وشارات البيع' : 'Ordering system, delivery zones and sale badges'}
          icon={<ShoppingBag size={18} />}
          lang={lang}
          collapsedGroups={collapsedGroups}
          onToggleCollapse={onToggleCollapse}
        >
          <OrderingSection
            collapsed={!!collapsedGroups['ordering']}
            onToggleCollapse={() => onToggleCollapse('ordering')}
            ordering={menu.settings.ordering}
            currency={menu.settings.currency[lang] || menu.settings.currency.en}
            lang={lang}
            whatsapp={menu.settings.whatsapp || ''}
            mapUrl={menu.settings.mapUrl || ''}
            adminFetch={adminFetch}
            onMenuRefreshed={onMenuRefreshed}
            onUpdate={(updater) =>
              onUpdateMenu((m) => ({
                ...m,
                settings: { ...m.settings, ordering: updater(m.settings.ordering) },
              }))
            }
            onMapUrlChange={(url) =>
              onUpdateMenu((m) => ({
                ...m,
                settings: { ...m.settings, mapUrl: url },
              }))
            }
          />

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

          {/* Smart-badge windows are a pro tuning surface (claimed Pro-only in
              pricing); starter keeps defaults. Same gate as OrderingSection. */}
          <SmartBadgesSection
            badges={menu.settings.badges}
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
        </SettingsParentGroup>
      )}

      {/* 2b. Payments — المدفوعات. COD is the live method (preselected +
          locked at checkout); online gateways are staged "soon" chips, and
          the Vexora card below sells the Visa-grade setup professionally. */}
      {featuresConfig.enableOrdering && (
        <SettingsParentGroup
          groupKey="grp-payments"
          title={isAr ? 'المدفوعات' : 'Payments'}
          subtitle={isAr ? 'الدفع عند الاستلام والبوابات الإلكترونية' : 'Cash on delivery and online gateways'}
          icon={<CreditCard size={18} />}
          lang={lang}
          collapsedGroups={collapsedGroups}
          onToggleCollapse={onToggleCollapse}
        >
          <PaymentsSection
            payments={menu.settings.payments ?? { codEnabled: true }}
            lang={lang}
            collapsed={!!collapsedGroups['payments']}
            onToggleCollapse={() => onToggleCollapse('payments')}
            onUpdate={(updater) =>
              onUpdateMenu((m) => ({
                ...m,
                settings: {
                  ...m.settings,
                  payments: updater(m.settings.payments ?? { codEnabled: true }),
                },
              }))
            }
          />
        </SettingsParentGroup>
      )}

      {/* 3. Notifications & Sound — التنبيهات والصوت */}
      {featuresConfig.enableOrdering && (
        <SettingsParentGroup
          groupKey="grp-notify"
          title={isAr ? 'التنبيهات والصوت' : 'Notifications & Sound'}
          subtitle={isAr ? 'تنبيهات تيليجرام والبريد وأصوات الجرس' : 'Telegram & email alerts and bell sounds'}
          icon={<BellRing size={18} />}
          lang={lang}
          collapsedGroups={collapsedGroups}
          onToggleCollapse={onToggleCollapse}
        >
          <TelegramSection lang={lang} adminFetch={adminFetch} onConfirm={onConfirm} collapsed={!!collapsedGroups['telegram']} onToggleCollapse={() => onToggleCollapse('telegram')} />

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
        </SettingsParentGroup>
      )}

      {/* 4. Display & Experience — العرض والتجربة */}
      <SettingsParentGroup
        groupKey="grp-display"
        title={isAr ? 'العرض والتجربة' : 'Display & Experience'}
        subtitle={isAr ? 'الوضع الافتراضي للزوار وساعات العمل والإعلانات والعرض' : 'Visitor defaults, hours, banners and display'}
        icon={<LayoutGrid size={18} />}
        lang={lang}
        collapsedGroups={collapsedGroups}
        onToggleCollapse={onToggleCollapse}
      >
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

        <ImageRecompressSection
          menu={menu}
          lang={lang}
          onUpdateMenu={onUpdateMenu}
          collapsed={!!collapsedGroups['img-recompress']}
          onToggleCollapse={() => onToggleCollapse('img-recompress')}
        />

      </SettingsParentGroup>

      {/* 5. Team & Crew — الفريق والطاقم (owner only: kitchen invites +
          delivery-crew sharing live here, apart from client access). */}
      {isOwner !== false && (
      <SettingsParentGroup
        groupKey="grp-team"
        title={isAr ? 'الفريق والطاقم' : 'Team & Crew'}
        subtitle={isAr ? 'دعوات المطبخ ومشاركة طاقم التليجرام' : 'Kitchen invites and Telegram crew sharing'}
        icon={<Users size={18} />}
        lang={lang}
        collapsedGroups={collapsedGroups}
        onToggleCollapse={onToggleCollapse}
      >
        {/* Kitchen invites + kitchen logins + delivery-crew sharing. */}
        <TeamAccessSection lang={lang} adminFetch={adminFetch} onConfirm={onConfirm} collapsed={!!collapsedGroups['team-access']} onToggleCollapse={() => onToggleCollapse('team-access')} />
      </SettingsParentGroup>
      )}

      {/* 6. Access & Diagnostics — الوصول والتشخيص (owner only: client
          logins never see the group — not even an empty shell). */}
      {isOwner !== false && (
      <SettingsParentGroup
        groupKey="grp-access"
        title={isAr ? 'الوصول والتشخيص' : 'Access & Diagnostics'}
        subtitle={isAr ? 'دعوات العملاء وجلسات المالك ومراقبة الأخطاء' : 'Client invites, master sessions and error monitoring'}
        icon={<ShieldCheck size={18} />}
        lang={lang}
        collapsedGroups={collapsedGroups}
        onToggleCollapse={onToggleCollapse}
      >
        {/* Client access: owner-minted invite links (hidden from client logins —
            the section hides itself on 403). Last: it is account-level, not menu. */}
        <AccessSection lang={lang} adminFetch={adminFetch} onConfirm={onConfirm} collapsed={!!collapsedGroups['access']} onToggleCollapse={() => onToggleCollapse('access')} />

        {/* Seasonal storefront theme (first season: Christmas). Sits in the
            same owner-only group — client logins never see it. */}
        <SeasonalSection
          seasonal={menu.settings.seasonal ?? { theme: 'off' }}
          lang={lang}
          collapsed={!!collapsedGroups['seasonal']}
          onToggleCollapse={() => onToggleCollapse('seasonal')}
          onUpdate={(updater) =>
            onUpdateMenu((m) => {
              const next = updater({ seasonal: m.settings.seasonal ?? { theme: 'off' } });
              return { ...m, settings: { ...m.settings, ...next } };
            })
          }
        />

        {/* Error monitoring (Sentry) diagnostics: owner-only, same 403-hide
            rule as AccessSection — client logins never see this. */}
        <SentrySection lang={lang} adminFetch={adminFetch} collapsed={!!collapsedGroups['sentry']} onToggleCollapse={() => onToggleCollapse('sentry')} />
      </SettingsParentGroup>
      )}
    </div>
  );
};
