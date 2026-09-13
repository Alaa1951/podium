# Resume Notes — الجلسة الجاية نكمل من هنا

آخر تحديث: بعد نظام الأرشفة والـ Wave Access وبداية الـ RBAC.

## الحالة الحالية (كلها type-check نظيف ✓)

- **الأرشفة**: Team.archivedAt + Series.archivedAt + User.archivedAt (migrations applied) — guards في series-guard.ts + اختبارات.
- **Wave Access**: WaveAccess model ✓، أزرار المنح في شاشة Score entry ✓، saveScore بيسمح لحامل الجرانت ✓، صفحة /my-wave ✓ (اختبرت live: شيت الموجة 2 بـ 9 فرق).
- **إعادة التسمية**: Competitors (المتنافسون) / Users (المستخدمون) ✓.
- **RBAC (في نصه)**: AccessRole model ✓ (migrations applied)، الكتالوج PERMISSION_GROUPS في access.ts ✓، permissions عبر الجلسة (token + refresh + getCurrentUser) ✓، requirePermission ✓، حماية الشاشات (users/audit/registrations/scores/waves/results/settings + layouts) ✓، شاشة /roles + RolesManager ✓، إسناد دور من AccountEditor ✓، i18n ✓.

## المتبقي لما نرجع

1. `npm run type-check` ثم `npx vitest run` (اختبارات access.test.ts اتظبطت بـ permissions — لو في failing شيل تعديلاتي المؤقتة في Factory).
2. `npm run build` — لو نجح، اعمل commit (شغل كبير غير مCommitt-ed لحد دلوقتي).
3. **Stress test** (المطلوب الجاي):
   - `npm run build` + شغّل production: PORT مختلف عن الـ dev أو اقفل dev الأول.
   - سكريبت `scripts/load-test.mjs` (fetch + worker pool) على: `/results`، `/results/{slug}/{cat}/{div}`، `/api/results/...`، `/series/{slug}/board` + `/api/series/{id}/board` (بـ cookie أدمن).
   - درجات تزامن: 50 / 100 / 250 / 500 (و1500 لو الأمور تمام) — سجل RPS وp95 وerrors.
   - افحص: pool الـ MariaDB adapter (limit 10 افتراضي)، MySQL `max_connections`، indexes على Team (seriesId + paymentStatus).
4. **تحسينات مقترحة معلّقة**: auto-advance مرفوض عمداً للـ first wave (يدوي) — لو عايز wall-clock start نراجع timezone.

## ملاحظات
- OTP_DEV_BYPASS=true في .env (شغال فقط في dev) — اشيله قبل أي deploy.
- Docker/MySQL لازم يكونوا شغالين قبل `npm run dev:bg`.
