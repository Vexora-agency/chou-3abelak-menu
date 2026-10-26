/* Privacy page logic: textContent only, no innerHTML anywhere. */
(function () {
  'use strict';

  var STR = {
    en: {
      eyebrow: 'Privacy', back: 'Back to menu', langBtn: 'العربية',
      collectT: 'What we collect', collect: [
        'Your name and phone number, so we can prepare your order and contact you about it.',
        'Your delivery address for delivery orders (or table number for dine-in).',
        'Your live location only if you tap “Share my location” (delivery only).',
        'Order notes you choose to write.',
        'The items, quantities and totals of your order, plus the time it was placed.'
      ],
      whyT: 'Why we collect it', why: [
        'To prepare and deliver your order.',
        'To contact you about your order if needed.',
        'To understand demand through anonymous statistics (never linked to you).'
      ],
      howT: 'How it is sent and stored',
      how: 'When you tap Send, your order travels as a WhatsApp message to the restaurant. WhatsApp delivery is also subject to WhatsApp\u2019s own privacy policy.',
      recordsOn: 'The restaurant also keeps an order record on Cloudflare infrastructure so it can track sales and serve you better.',
      recordsOff: 'Order recording is currently disabled, so no order record is stored on our servers.',
      keepT: 'How long we keep it',
      thirdT: 'Third parties', third: [
        'Cloudflare — hosts this website and stores order records.',
        'Google Fonts — provides the fonts; it may receive technical request data.',
        'OpenStreetMap — only if you open the in-cart location picker: map tiles load from their servers and the address lookup runs on confirmation.'
      ],
      deviceT: 'On your device',
      deviceText: 'We store your cart and your language/theme choices on your own device only. There are no advertising or tracking cookies.',
      extraT: 'Additional notes from the restaurant',
      rightsT: 'Your rights',
      phoneLabel: 'Phone', waLabel: 'WhatsApp'
    },
    ar: {
      eyebrow: 'الخصوصية', back: 'العودة للمنيو', langBtn: 'English',
      collectT: 'ما الذي نجمعه', collect: [
        'اسمك ورقم هاتفك، لتجهيز طلبك والتواصل معك بشأنه.',
        'عنوان التوصيل لطلبات التوصيل (أو رقم الطاولة داخل المطعم).',
        'موقعك المباشر فقط إذا ضغطت «مشاركة موقعي» (للتوصيل فقط).',
        'ملاحظات الطلب التي تكتبها باختيارك.',
        'الأصناف والكميات والإجمالي ووقت تقديم الطلب.'
      ],
      whyT: 'لماذا نجمعه', why: [
        'لتجهيز طلبك وتوصيله.',
        'للتواصل معك بشأن طلبك عند الحاجة.',
        'لفهم الطلب عبر إحصاءات مجهولة (غير مرتبطة بك أبداً).'
      ],
      howT: 'كيف يُرسل وأين يُحفظ',
      how: 'عند الضغط على إرسال، يصل طلبك كرسالة واتساب إلى المطعم. وتخضع رسائل واتساب أيضاً لسياسة الخصوصية الخاصة بواتساب.',
      recordsOn: 'يحتفظ المطعم أيضاً بسجل للطلبات على بنية Cloudflare التحتية لمتابعة المبيعات وخدمتك بشكل أفضل.',
      recordsOff: 'تسجيل الطلبات متوقف حالياً، فلا يُحفظ أي سجل للطلبات على خوادمنا.',
      keepT: 'مدة الاحتفاظ',
      thirdT: 'أطراف خارجية', third: [
        'Cloudflare — تستضيف هذا الموقع وتخزن سجلات الطلبات.',
        'Google Fonts — توفر الخطوط؛ وقد تصلها بيانات تقنية عن الطلب.',
        'OpenStreetMap — فقط إذا فتحت منتقي الموقع في السلة: تُحمّل صور الخريطة من خوادمهم ويعمل البحث عن العنوان عند التأكيد.'
      ],
      deviceT: 'على جهازك',
      deviceText: 'نخزن سلتك واختيارات اللغة والمظهر على جهازك فقط. لا توجد ملفات تعريف إعلانية أو تتبع.',
      extraT: 'ملاحظات إضافية من المطعم',
      rightsT: 'حقوقك',
      phoneLabel: 'الهاتف', waLabel: 'واتساب'
    }
  };

  function getLang() {
    try {
      var s = localStorage.getItem('menu_lang_v1');
      if (s === 'ar' || s === 'en') return s;
    } catch (e) {}
    return 'en';
  }
  function setLang(l) {
    try { localStorage.setItem('menu_lang_v1', l); } catch (e) {}
    render(l);
  }
  function el(id) { return document.getElementById(id); }
  function fillList(id, items) {
    var ul = el(id);
    ul.textContent = '';
    items.forEach(function (t) {
      var li = document.createElement('li');
      li.textContent = t;
      ul.appendChild(li);
    });
  }

  function render(lang) {
    var t = STR[lang] || STR.en;
    var isAr = lang === 'ar';
    document.documentElement.lang = lang;
    document.documentElement.dir = isAr ? 'rtl' : 'ltr';
    document.title = isAr ? 'الخصوصية' : 'Privacy';
    el('langToggle').textContent = t.langBtn;
    el('backLink').textContent = t.back;
    el('backLink2').textContent = t.back;
    document.querySelectorAll('[data-i18n]').forEach(function (n) {
      var k = n.getAttribute('data-i18n');
      if (typeof t[k] === 'string') n.textContent = t[k];
    });
    fillList('collectList', t.collect);
    fillList('whyList', t.why);
    fillList('thirdList', t.third);

    fetch('/api/menu').then(function (r) { return r.ok ? r.json() : null; }).then(function (menu) {
      var name = '', phone = '', wa = '', extra = '';
      try {
        var s = menu && menu.settings ? menu.settings : {};
        name = isAr ? (s.name.ar || s.name.en) : (s.name.en || s.name.ar);
        phone = s.phone || '';
        var digits = String(s.whatsapp || '').replace(/[^0-9]/g, '');
        wa = digits ? 'https://wa.me/' + digits : '';
        extra = isAr ? (s.privacy && s.privacy.extra.ar) : (s.privacy && s.privacy.extra.en);
        if (!extra && s.privacy && s.privacy.extra) extra = isAr ? s.privacy.extra.en : s.privacy.extra.ar;
      } catch (e) {}
      document.querySelector('[data-restaurant]').textContent = name || (isAr ? 'المطعم' : 'Restaurant');
      var pl = el('phoneLink');
      pl.textContent = t.phoneLabel + (phone ? ': ' + phone : '');
      pl.href = phone ? 'tel:' + phone.replace(/[^0-9+]/g, '') : '#';
      var wl = el('waLink');
      wl.textContent = t.waLabel;
      wl.href = wa || '#';
      var rt = el('rightsText');
      rt.textContent = isAr
        ? 'يمكنك طلب نسخة من بياناتك أو حذفها في أي وقت عبر التواصل مع المطعم على الهاتف أو واتساب.'
        : 'You can ask for a copy of your data or its deletion at any time by contacting the restaurant by phone or WhatsApp.';
      if (extra) {
        el('extraCard').hidden = false;
        el('extraText').textContent = extra;
      } else {
        el('extraCard').hidden = true;
      }
      el('howText').textContent = t.how;
    }).catch(function () {
      el('howText').textContent = t.how;
    });

    fetch('/api/privacy-info').then(function (r) { return r.ok ? r.json() : null; }).then(function (info) {
      if (!info) return;
      var keep = isAr
        ? 'تُحذف بيانات العملاء (الاسم والهاتف والعنوان والملاحظات والموقع) بعد ' + info.piiDays + ' يوماً. وتُحفظ سجلات الطلبات مجهولة الهوية لمدة ' + info.orderMonths + ' شهراً.'
        : 'Customer details (name, phone, address, notes, location) are removed after ' + info.piiDays + ' days. Anonymous order records are kept for ' + info.orderMonths + ' months.';
      el('keepText').textContent = keep;
      el('recordsText').textContent = info.hasOrderRecords ? t.recordsOn : t.recordsOff;
    }).catch(function () {});
  }

  el('langToggle').addEventListener('click', function () {
    setLang(getLang() === 'ar' ? 'en' : 'ar');
  });
  render(getLang());
})();
