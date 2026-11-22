# Arabic copy: Modern Standard Arabic only

This is the long-term rule for every Arabic string and every Arabic reply in this project.

## Core rule

Write in **Modern Standard Arabic (MSA)** with a neutral pan-Arab register. The text must be understood by readers in every Arab country. Do not use Egyptian or any other regional dialect in:

- customer-facing UI strings
- admin and kitchen UI strings
- validation, error, and notification copy
- emails, SMS, WhatsApp, and push messages
- documentation and release notes
- Arabic replies to the user

English copy is unaffected.

## Vocabulary: replace dialect with MSA

| Dialect | MSA |
|---|---|
| معنديش / معندكش | لا أملك / لا تملك |
| ابعت | أرسل |
| خد | خذ / استلم |
| تاني | مرة أخرى |
| كده / كدة | هكذا |
| ده / دي / دول | هذا / هذه / هؤلاء |
| دلوقتي | الآن |
| علشان / عشان | لأن / لكي |
| مش | ليس / لا |
| بتاع / بتاعت | الخاص بـ / التابع لـ |
| خلي | اترك / اجعل (حسب السياق) |
| لسه | لم يعد / ما زال |
| برضه | أيضًا |
| أوي | جدًا |
| خالص | إطلاقًا |
| بس | فقط / لكن |
| يعني | أي |
| كمان | أيضًا |
| مافيش / مفيش | لا يوجد |
| حاول تاني | حاول مرة أخرى |
| جرّب تاني | جرّب مرة أخرى |

## Before / after

| Before (dialect) | After (MSA) |
|---|---|
| `معنديش واتساب — ابعت SMS` | `لا أملك واتساب — أرسل رمزًا عبر SMS` |
| `معندكش واتساب؟ استلم الكود SMS` | `لا تملك واتساب؟ استلم الرمز عبر SMS` |
| `الكود غلط. حاول تاني.` | `الرمز غير صحيح. حاول مرة أخرى.` |
| `خد وقت؟ جرّب تاني أو استخدم SMS.` | `هل تأخر التأكيد؟ تحقق مرة أخرى أو استخدم SMS.` |
| `هنبعت كود من 6 أرقام على الرقم ده.` | `سنرسل رمزًا مكوّنًا من 6 أرقام إلى هذا الرقم.` |
| `الإشعارات متوقفة — مش هيوصلك تنبيه.` | `الإشعارات متوقفة — لن يصلك تنبيه.` |
| `المتصفح ده مش بيدعم تنبيهات الخلفية.` | `هذا المتصفح لا يدعم تنبيهات الخلفية.` |
| `تعذّر تفعيل الإشعارات — حاول تاني.` | `تعذّر تفعيل الإشعارات — حاول مرة أخرى.` |

## Style checklist

- Use `هذا` / `هذه` / `الذي` / `التي` instead of `ده` / `دي` / `اللي`.
- Use `الآن` instead of `دلوقتي`.
- Use `مرة أخرى` instead of `تاني`.
- Use `لا يوجد` instead of `مفيش`.
- Use `أيضًا` instead of `كمان` or `برضه`.
- Use `فقط` instead of `بس` when it means “only”.
- Use `لأن` instead of `علشان` / `عشان`.
- Use `الخاص بـ` instead of `بتاع`.
- Prefer `رمز` for a verification code; `كود` is a loanword and is acceptable only when it is part of a technical label that is already established (for example `SMS`).
- Keep sentences short and labels concise; formal does not mean long.
- Read the string aloud: if it sounds like a local conversation rather than neutral written Arabic, rewrite it.

## Scope note

This rule is permanent. Add new Arabic copy in MSA from the start; do not translate dialect later unless a legacy string is explicitly in scope.
