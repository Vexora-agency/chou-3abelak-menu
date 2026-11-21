# إعداد WhatsApp Cloud API — خطوة بخطوة

هذا الدليل يفعّل **التحقق التلقائي** لرقم العضو. حتى تكتمل الخطوات، الاعتماد
اليدوي من لوحة التحكم يظل شغالًا.

## أولًا: هل رقمك مناسب؟

**Cloud API** هو واجهة Meta التي تسمح للموقع:
- يستقبل رسائل الواتساب (Webhook)،
- يرد تلقائيًا على العضو.

هو **ليس** تطبيق WhatsApp Business العادي على الهاتف.

| عندك | ينفع؟ | المطلوب |
|---|---|---|
| رقم على **WhatsApp Business Platform / Cloud API** (يظهر له Phone Number ID) | ✅ مباشرة | تابع من الخطوة 2 |
| رقم على **تطبيق WhatsApp Business** فقط | ⚠️ يحتاج Coexistence | اربط الرقم بالـCloud API عبر Coexistence، أو استخدم رقمًا مخصصًا للتحقق |
| رقم شخصي على WhatsApp العادي | ❌ | لا تستخدمه؛ استخدم رقمًا مخصصًا |

> لو مش متأكد: افتح `developers.facebook.com` → تطبيقك → WhatsApp → **API Setup**.
> لو شفت **Phone Number ID** و **Temporary access token**، فأنت على Cloud API.

## ثانيًا: إنشاء التطبيق وربط الرقم

1. افتح <https://developers.facebook.com/apps>.
2. **Create App** → اختر **Business** → اسم التطبيق (مثال: Chou 3abelak) → Create.
3. من لوحة التطبيق: **Add Product** → **WhatsApp** → Set up.
4. **WhatsApp → API Setup**:
   - اختر/أنشئ **WhatsApp Business Account (WABA)**.
   - أضف **رقم الهاتف** ووثّقه بكود SMS أو مكالمة.
   - انسخ **Phone Number ID** (رقم طويل، وليس رقم الهاتف).
   - انسخ **WhatsApp Business Account ID** (تحتاجه أحيانًا في الدعم فقط).
5. لو الرقم مستخدم على تطبيق WhatsApp Business:
   - ابحث عن **Coexistence** في إعدادات WhatsApp، أو استخدم رقمًا آخر مخصصًا للتحقق.
   - لو استخدمت رقمًا مخصصًا، ضعه في `WHATSAPP_VERIFICATION_NUMBER` (اختياري) حتى يرسل الموقع الرسالة إليه.

## ثالثًا: التوكن الدائم (Access Token)

التوكن المؤقت في API Setup ينتهي بعد 24 ساعة — لا تستخدمه في الإنتاج.

1. افتح <https://business.facebook.com/settings>.
2. **Users → System Users → Add**.
3. اسم (مثال: `chou-whatsapp-bot`) → الدور **Admin** → Create.
4. اختر **Assign Assets** → أضف تطبيقك و/أو الـWABA.
5. **Generate New Token**:
   - اختر تطبيقك.
   - فعّل **`whatsapp_business_messaging`** (وإن ظهر `whatsapp_business_management`).
   - Expiration: **Never** إن كان متاحًا.
   - Generate → انسخ التوكن **مرة واحدة** واحفظه في مكان آمن. لا تضعه في الشات.

## رابعًا: App Secret و Verify Token

1. **App Secret:** من لوحة التطبيق → **App Settings → Basic → App Secret → Show**.
   - هذا هو `WHATSAPP_APP_SECRET`.
2. **Verify Token:** أنشئ نصًا عشوائيًا طويلًا (32 حرفًا فأكثر). مثال من جهازك:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   - هذا هو `WHATSAPP_VERIFY_TOKEN`. نفس القيمة ستُدخل في Meta وفي Cloudflare.

## خامسًا: إضافة المتغيرات في Cloudflare

الطريقة الأسهل من لوحة التحكم:

1. افتح <https://dash.cloudflare.com>.
2. **Workers & Pages → chou-3abelak-menu → Settings → Environment variables**.
3. أضف في **Production** (و**Preview** أيضًا):

| الاسم | القيمة | سري؟ |
|---|---|---|
| `WHATSAPP_APP_SECRET` | App Secret | ✅ Encrypt |
| `WHATSAPP_VERIFY_TOKEN` | النص العشوائي | ✅ Encrypt |
| `WHATSAPP_ACCESS_TOKEN` | System User Token | ✅ Encrypt |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone Number ID | يفضّل Encrypt |
| `WHATSAPP_VERIFICATION_NUMBER` | رقم Cloud API (اختياري) | — |
| `WHATSAPP_GRAPH_VERSION` | `v24.0` (اختياري) | — |
| `WHATSAPP_REPLY_MONTHLY_CAP` | `900` (اختياري) | — |

4. **Save**.
5. **أعد النشر**: Deployments → آخر Deployment → **Retry deployment**. المتغيرات لا تصل للـFunctions إلا بعد نشر جديد.

بديل عبر CLI (يُدخل القيمة في الطرفية بدون عرضها في الشات):

```bash
npx wrangler pages secret put WHATSAPP_APP_SECRET --project-name chou-3abelak-menu
npx wrangler pages secret put WHATSAPP_VERIFY_TOKEN --project-name chou-3abelak-menu
npx wrangler pages secret put WHATSAPP_ACCESS_TOKEN --project-name chou-3abelak-menu
npx wrangler pages secret put WHATSAPP_PHONE_NUMBER_ID --project-name chou-3abelak-menu
```

## سادسًا: ربط الويب هوك في Meta

1. لوحة التطبيق → **WhatsApp → Configuration**.
2. **Webhook → Edit**:
   - **Callback URL:** `https://chou3abelak.site/api/whatsapp/webhook`
   - **Verify token:** نفس `WHATSAPP_VERIFY_TOKEN`.
3. اضغط **Verify and save**. لازم تظهر علامة نجاح؛ لو ظهر خطأ:
   - تأكد أن المتغيرات أُضيفت وأُعيد النشر.
   - تأكد أن Cloudflare Access لا يحمي `/api/whatsapp/webhook`.
4. بعد الحفظ: **Webhook fields → Manage** → فعّل **messages**.

## سابعًا: استبعاد الويب هوك من Cloudflare Access

Meta لا تستطيع تجاوز شاشة Cloudflare Access. لو Access يغطي `/api/*`:

- افتح **Zero Trust → Access → Applications**.
- استبعد المسار `/api/whatsapp/webhook` (أو أزل Access عن `/api/*`).
- الحماية الفعلية للويب هوك هي توقيع Meta (`X-Hub-Signature-256`)، وليست Access.

## ثامنًا: الاختبار

1. افتح الموقع وسجّل الدخول.
2. اطلب رقمًا جديدًا (أو غيّر رقم الحساب) → ستظهر شاشة الرمز.
3. اضغط **أرسل عبر واتساب** → أرسل الرسالة من نفس الرقم.
4. المتوقع:
   - رسالة واتساب: `✅ تم تأكيد رقمك بنجاح…` (أو English حسب لغة الموقع).
   - صفحة الموقع تتحول إلى **تم تأكيد الرقم** خلال ثوانٍ.
5. جرّب رمزًا خاطئًا: يجب أن يصلك `❌ لقد كتبت كودًا خاطئًا…` ويظل الطلب معلّقًا.
6. لو لم يصلك رد:
   - Meta → WhatsApp → Configuration → Webhook → **View logs**.
   - Cloudflare → Pages → Functions logs.
   - تأكد أن `WHATSAPP_ACCESS_TOKEN` و`WHATSAPP_PHONE_NUMBER_ID` صحيحان.

## تاسعًا: الإنتاج والدفع

- التطبيق لازم يكون **Live** (وليس Development) عشان يستقبل رسائل من أرقام حقيقية.
- أضف **وسيلة دفع** في Meta Billing Hub لو تتوقع تجاوز 1,000 رد شهريًا؛ بدونها تتوقف رسائل الخدمة بعد الحد المجاني.
- حدود Meta للرسائل (Messaging Limits) تبدأ من 1,000 عميل فريد/يوم وتزيد مع الجودة؛ Business Verification قد تُطلب للحدود الأعلى.

## العاشر: التكلفة المختصرة

- الوارد من العميل: **مجاني**.
- الرد التلقائي = **Service Message** داخل نافذة 24 ساعة، بدون Template.
- أول **1,000 Service Message شهريًا لكل رقم بزنس**: مجاني (من 1 أكتوبر 2026).
- بعدها: سعر السوق، ولبنان ضمن **Rest of Middle East** (~$0.0091 للرسالة حسب جداول المزودين الحالية — راجع Rate Card ميتا).
- إعدادنا الافتراضي يوقف الردود عند **900/شهر**، فتبقى التكلفة **$0** في الاستخدام العادي.

## مراجع

- <https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing>
- <https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages>
- <https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users>
