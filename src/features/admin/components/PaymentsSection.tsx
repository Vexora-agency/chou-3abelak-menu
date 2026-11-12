import React from 'react';
import type { MenuSettings } from '@/src/types/menu';
import { SettingsGroupBody, SettingsGroupHeader } from './SettingsCollapsible';
import { Banknote, CreditCard, Landmark, ShieldCheck, Sparkles, Wallet } from 'lucide-react';

type Payments = NonNullable<MenuSettings['payments']>;

interface PaymentsSectionProps {
  payments: Payments | undefined;
  lang: 'en' | 'ar';
  onUpdate: (updater: (prev: Payments) => Payments) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const DEFAULTS: Payments = { codEnabled: true };

/** Payments card of the admin Settings tab — COD live, gateways staged. */
export const PaymentsSection: React.FC<PaymentsSectionProps> = ({
  payments,
  lang,
  onUpdate,
  collapsed = false,
  onToggleCollapse,
}) => {
  const isAr = lang === 'ar';
  const cur: Payments = payments ?? { ...DEFAULTS };
  const codOn = cur.codEnabled !== false;

  const future = [
    { id: 'visa', label: isAr ? 'فيزا' : 'Visa' },
    { id: 'mastercard', label: isAr ? 'ماستركارد' : 'Mastercard' },
    { id: 'paypal', label: 'PayPal' },
    { id: 'stripe', label: 'Stripe' },
    { id: 'bank', label: isAr ? 'تحويل بنكي' : 'Bank transfer' },
  ];

  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800">
      <SettingsGroupHeader
        title={isAr ? 'طرق الدفع' : 'Payment methods'}
        subtitle={isAr ? 'الدفع عند الاستلام مفعّل — البوابات الإلكترونية تُجهَّز لاحقًا' : 'Cash on delivery is live — online gateways plug in later'}
        lang={lang}
        collapsed={collapsed}
        onToggle={() => onToggleCollapse?.()}
      />
      <SettingsGroupBody open={!collapsed}>
        {/* Live method: COD — preselected by default, the checkout locks to it. */}
        <div className={`rounded-2xl border-2 p-3.5 transition-colors ${codOn ? 'border-[var(--primary)]/60 bg-[var(--primary)]/[0.05]' : 'border-neutral-800 bg-black/40'}`}>
          <button
            type="button"
            role="switch"
            aria-checked={codOn}
            onClick={() => onUpdate((prev) => ({ ...(prev ?? { ...DEFAULTS }), codEnabled: !((prev ?? { ...DEFAULTS }).codEnabled !== false) }))}
            className="w-full flex items-center gap-3 text-start min-h-[44px] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          >
            <span className={`shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center ${codOn ? 'bg-[var(--primary)] text-[#0A0A0A]' : 'bg-neutral-800 text-neutral-400'}`}>
              <Banknote size={20} strokeWidth={2.25} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-black text-white">
                {isAr ? 'الدفع عند الاستلام' : 'Cash on Delivery'}
                <span className={`ms-2 inline-block text-[10px] font-extrabold px-2 py-0.5 rounded-full align-middle ${codOn ? 'bg-green-500/15 text-green-400 border border-green-500/30' : 'bg-neutral-800 text-neutral-500 border border-neutral-700'}`}>
                  {codOn ? (isAr ? 'مفعّلة' : 'Enabled') : (isAr ? 'مطفأة' : 'Off')}
                </span>
              </span>
              <span className="block text-[11px] text-neutral-500 mt-0.5">
                {codOn
                  ? (isAr ? 'مفعّلة — العميل يدفع نقدًا عند وصول الطلب (الخيار الوحيد حاليًا)' : 'On — customer pays cash on arrival (the only option for now)')
                  : (isAr ? 'مطفأة' : 'Off')}
              </span>
            </span>
            <span className={`relative w-11 h-6 shrink-0 rounded-full transition-colors duration-200 ${codOn ? 'bg-[var(--primary)]' : 'bg-neutral-700'}`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${codOn ? (isAr ? 'left-0.5' : 'left-5') : (isAr ? 'left-5' : 'left-0.5')}`} />
            </span>
          </button>
          {codOn && (
            <p className="mt-2.5 flex items-center gap-1.5 text-[11px] font-bold text-neutral-500 anim-fade-in">
              <ShieldCheck size={13} className="shrink-0 text-green-500" />
              {isAr ? 'آمنة 100% — لا تُجمع أي بيانات بنكية من العميل.' : '100% safe — no bank details are ever collected.'}
            </p>
          )}
        </div>

        {/* Staged gateways: one row of the most important marks (not the full
            wall) — disabled with Soon badges so activation is a flag-flip. */}
        <div className="rounded-2xl border border-neutral-800 bg-black/40 p-3.5">
          <p className="flex items-center gap-1.5 text-xs font-black text-white">
            <CreditCard size={15} className="text-[var(--primary)]" />
            {isAr ? 'بوابات الدفع الإلكتروني' : 'Online gateways'}
            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400">
              {isAr ? 'قريبًا' : 'Soon'}
            </span>
          </p>
          <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">
            {isAr
              ? 'البنية جاهزة — التفعيل لاحقًا دون تغيير تصميم السلة.'
              : 'Wiring is ready — activation later with no checkout redesign.'}
          </p>
          <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5" style={{ scrollbarWidth: 'none' }}>
            {future.map((m) => (
              <span key={m.id} className="shrink-0 inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-500 text-xs font-bold">
                {m.id === 'bank' ? <Landmark size={14} className="opacity-60" /> : m.id === 'paypal' || m.id === 'stripe' ? <Wallet size={14} className="opacity-60" /> : <CreditCard size={14} className="opacity-60" />}
                <span dir="auto">{m.label}</span>
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wide bg-neutral-800 text-neutral-500">
                  {isAr ? 'قريبًا' : 'Soon'}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* Vexora upsell — professional agency CTA for Visa-grade payments. */}
        <div className="relative overflow-hidden rounded-2xl border border-[var(--primary)]/40 bg-gradient-to-br from-[var(--primary)]/[0.12] via-black to-black p-4">
          <div className="absolute -top-8 -end-8 w-32 h-32 rounded-full bg-[var(--primary)]/15 blur-2xl pointer-events-none" aria-hidden="true" />
          <p className="flex items-center gap-1.5 text-xs font-black text-[var(--primary)]">
            <Sparkles size={14} />
            {isAr ? 'استلم مدفوعاتك بالفيزا والماستركارد' : 'Accept Visa & Mastercard payments'}
          </p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-300">
            {isAr
              ? 'هل تريد استلام مدفوعاتك بالفيزا وغيرها بشكل احترافي وآمن؟ فريقنا يجهّز لك بوابة الدفع المناسبة ويربطها بمتجرك من البداية للنهاية.'
              : 'Want to accept Visa and more, professionally and securely? Our team sets up the right gateway and wires it into your store end-to-end.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href="https://vexora.agency"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-tactile h-11 min-h-[44px] px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-black inline-flex items-center gap-1.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            >
              {isAr ? 'تواصل معنا' : 'Contact us'} · vexora.agency
            </a>
            <a
              href="mailto:info@vexora.agency"
              className="btn-tactile h-11 min-h-[44px] px-5 rounded-full border border-neutral-700 text-neutral-200 text-xs font-bold inline-flex items-center hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              dir="ltr"
            >
              info@vexora.agency
            </a>
          </div>
        </div>
      </SettingsGroupBody>
    </div>
  );
};
