# بدء الصور من الصفر — IMAGE FRESH START

الهدف: مسح كل صور الأصناف القديمة، ثم رفع صور جديدة نظيفة عبر البايبلاين
الجديد `imageVariants`. الأداة: `scripts/wipe-images.mjs` (Node فقط، بدون
dependencies جديدة، والوضع الافتراضي قراءة فقط).

> ⚠️ الصور الحقيقية تعيش في إنتاج Cloudflare (KV `MENU_KV` + R2
> `chou-3abelak-images`) ولا يمكن لمسها من هذا الجهاز بدون credentials.
> كل أوامر الإنتاج أدناه تُنفَّذ من جهاز فيه `wrangler` مسجَّل الدخول
> (`npx wrangler login`) أو من Cloudflare Dashboard.

## الخطوات (بالترتيب)

### 1. باك أب من الإنتاج (قبل أي شيء)

```bash
# نسخة JSON من المنيو الحالي في KV (للرجوع إليها عند الحاجة)
npx wrangler kv key get --remote --namespace-id=<MENU_KV_ID> "menu" > menu-backup-prod.json
```

> `MENU_KV_ID` من: Cloudflare Dashboard → Workers & Pages → KV.
> بديل: صفحة الأدمن → النسخ الاحتياطي/التصدير إن كان متاحاً.

### 2. إنتاج ملف منيو منظَّف (strip)

```bash
# تجربة جافة أولاً — قراءة فقط، لا يكتب شيئاً
node scripts/wipe-images.mjs --source=menu.seed.json

# التنظيف الفعلي (يكتب باك أب تلقائياً menu-backup-<timestamp>.json بجانب --in)
node scripts/wipe-images.mjs --strip --in=menu.seed.json --out=menu.stripped.json

# تأكيد النظافة
node scripts/wipe-images.mjs --source=menu.stripped.json
# المتوقع: imageUrl داخلية 0 · خارجية 0 · variants 0 · R2 keys 0
```

### 3. رفع المنيو المنظَّف عبر الأدمن

ارفع `menu.stripped.json` من صفحة الأدمن (استيراد/حفظ المنيو) — هذه أول
عملية **حفظ** بعد التنظيف، وهي ما يشغّل دورة GC (الخطوة 4).

### 4. تأكيد GC — المسح التلقائي للأيتام (مهم)

بعد أول حفظ للمنيو بدون صور، يمسح `maybeGcOrphanImages`
(`functions/_shared/image-gc.js`) تلقائياً كل كائنات R2 تحت `menu/` التي
لم تعد مشاراً إليها — **بشرط أن يكون عمرها > 15 دقيقة** (أرضية الأمان
`MIN_AGE_MS`، حتى لا تُمسح صورة رُفعت للتو أثناء autosave).

- تحقق من سجلات الـ Worker: ابحث عن `{"evt":"image_gc","deleted":N}`.
- انتظر > 15 دقيقة بعد آخر رفع قديم، ثم احفظ المنيو مرة ثانية لتأكيد
  اكتمال المسح.
- ملاحظة: زر `DELETE /api/admin/images?key=...` يرفض (409 `in_use`) أي
  صورة ما زال المنيو يشير إليها — لذا الترتيب (strip أولاً ثم مسح) إلزامي.

### 5. مسح أيتام R2 المتبقية يدوياً (اختياري — فقط ما لم يمسحه GC)

```bash
# 5أ. سرد المفاتيح تحت menu/ فقط (قراءة فقط عبر R2 REST API؛
# wrangler لا يملك أمر list، لهذا السرد هنا بـ fetch وليس wrangler)
export CLOUDFLARE_ACCOUNT_ID=<account-id>
export CLOUDFLARE_API_TOKEN=<token بصلاحية R2 قراءة>
node scripts/wipe-images.mjs --r2-list --out=r2-keys.json
# bucket الافتراضي: chou-3abelak-images (غيّره بـ --bucket=... عند الحاجة)

# 5ب. تجربة جافة للحذف (تطبع ما سيُحذف فقط — نفّذها أولاً دائماً)
node scripts/wipe-images.mjs --r2-delete --keys-file=r2-keys.json

# 5ج. الحذف الفعلي (يتطلب --confirm، ويحفظ لقطة المفاتيح
# menu-backup-r2-<timestamp>.json قبل الحذف، ويحذف عبر wrangler)
node scripts/wipe-images.mjs --r2-delete --keys-file=r2-keys.json --confirm
```

أوامر `wrangler` المكافئة (للمرجع — السكربت ينفّذها نيابة عنك):

```bash
npx wrangler r2 object delete chou-3abelak-images/menu/2026/01/<uuid>.jpg --remote
```

الحماية مدمجة في السكربت: أي `--prefix` خارج `menu/` مرفوض (exit 2)، وأي
مفتاح لا يبدأ بـ `menu/` مرفوض، والحذف بدون `--confirm` تجربة جافة فقط.

### 6. رفع صور جديدة عبر البايبلاين الجديد

من صفحة الأدمن ارفع صور الأصناف من جديد — كل رفع يولّد `imageVariants`
ويُعلِّم `img:gc`. بعد انتهاء الرفع، احفظ المنيو مرة أخيرة ثم تحقق:

```bash
# المنيو الجديد يجب أن يُظهر الصور الجديدة فقط
node scripts/wipe-images.mjs --source=<ملف-المنيو-الجديد>
```

## الخلاصة السريعة

| خطوة | أمر |
|---|---|
| باك أب إنتاج | `npx wrangler kv key get --remote --namespace-id=<ID> "menu" > menu-backup-prod.json` |
| فحص محلي | `node scripts/wipe-images.mjs --source=menu.seed.json` |
| تنظيف محلي | `node scripts/wipe-images.mjs --strip --in=menu.seed.json --out=menu.stripped.json` |
| رفع المنيو | عبر صفحة الأدمن (استيراد `menu.stripped.json` + حفظ) |
| تأكيد GC | سجلات الـ Worker: `{"evt":"image_gc","deleted":N}` بعد 15+ دقيقة وحفظ ثانٍ |
| سرد الأيتام | `node scripts/wipe-images.mjs --r2-list --out=r2-keys.json` |
| حذف الأيتام | `node scripts/wipe-images.mjs --r2-delete --keys-file=r2-keys.json --confirm` |
| صور جديدة | رفع عبر الأدمن (`imageVariants`) + حفظ أخير |

ملاحظة حالة المستودع (2026-11-10): `menu.seed.json` فيه 52 صنفاً و**0 صور**
أصلاً — التنظيف المحلي جاهز، والعمل الحقيقي كله في إنتاج Cloudflare.
