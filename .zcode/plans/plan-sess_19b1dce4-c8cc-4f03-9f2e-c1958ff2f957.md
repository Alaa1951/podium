# خطة CTO شاملة: وصول عام + رعاة + توحيد UI مع المرجع

## خلاصة المراجعة (اللي وصلنا لها)

**✅ الوصول العام قائم فعلاً معمarilyاً:** `proxy.ts` يفتح `/results` (PUBLIC_PATHS:13-24) وصفحات `(public)` الثلاث تستعلم بلا أي auth — هتتحقق live بـ curl كسجل نهائي.

**🔴 3 ثغرات أمنية (CTO-level) وجدتها الاستكشافات:**
1. **`/api/series/[series]/board` مفتوح لأي مسجّل** (route.ts:14-15 — authN فقط بلا role): أي competitor/studio يقدر يعمل poll للبورد الحي غير المنشور لأي حدث بكل الدرجات. لازم role check.
2. **تناقض النشر:** `public-results.ts:33` يعتبر `final` + `resultsPublicAt: null` منشور، بينما `visibility.ts:64` يقول null = خاص. سيت穆 نواية التصميم الموثقة: null = غير منشور (الأدمن ينشر صراحة).
3. **PII زايدة على المسار العام:** `publishedTeam` يرجع phone/email/dateOfBirth للمتنافسين والصفحة تعرض fullName فقط — نقصّ الـ select.

**🎨 10 فروقات UI عن المرجع (bodyfittraining.au/podium) في صفحات الـ Final Results** — عدّتها وكتبتها بالتفصيل مع file:line (لون العنوان، سلسلة ///، عداد UPDATING IN، اللوجو المكدس، glow المعادن، gating عمود STUDIO، contrast الفلاتر، أنيميشن الصفوف، chip الترتيب دايماً برونزي في صفحة الفريق، شريط الرعاة على العام).

**🏗️ الرعاة:** لا يوجد أي upload infra، وpublic/ مخبوزة في Docker image (filesystem غير قابل للبقاء) → التخزين الصح: **MySQL + API route**.

---

## المرحلة 1 — الأمان والوصول العام (الأولوية)

1. **التحقق النهائي بالـ curl من غير cookies** على `/results` و`/results/podium-series-1/Womens/Pro` — توثيق أن أي زائر يفتحها.
2. **قفل الـ board API:** `requireRole("admin")` في `/api/series/[series]/board/route.ts` (الاستوديو عنده شاشاته الخاصة).
3. **توحيد النشر:** `public-results.ts` يتطلب `resultsPublicAt` فعلي (null = خاص زي visibility.ts) + تحديث seed-scenarios ليضبط `resultsPublicAt` على podium-series-1 (النهائي) + مسح إعدادات السيناريوهات.
4. **تقليل PII:** `publishedTeam` يرجع فقط الحقول المعروضة (fullName, الترتيب, الدرجات).

## المرحلة 2 — شاشة الرعاة لكل Event

5. **Prisma:** model `Sponsor { id, seriesId (cascade), alt, position, imageB64 @db.MediumText, mimeType }` + `@@unique([seriesId, position])` + migration باسم `sponsor_logos`.
6. **Server actions** (نمط zones.ts بالحرف): `saveSponsor` (base64 من الـ form client-side، حد 1MB، png/jpg/webp/svg) و`deleteSponsor` — requireRole("admin") + zod + recordAudit (مفتاح جديد seriesSponsorChanged) + revalidatePath. إعادة ترتيب تلقائية بالحذف.
7. **عرض اللوجو:** `GET /api/series/[series]/sponsors/[id]/logo` — عام القراءة (يظهر على شاشات العرض) مع `Cache-Control: immutable`.
8. **Admin UI:** قسم "Sponsors" في صفحة إعدادات الحدث بجانب ZoneEditor: رفع + اسم بديل + سحب ترتيب بسيط (أزرار أعلى/أسفل) + حذف، بنفس نمط SettingsForm (useT, notice errors, router.refresh).
9. **التوصيل للشاشات:** `buildBoardPayload` + `publishedCompetition` يرجعوا `sponsors: {src, alt}[]` (src = رابط الـ API route) → `SponsorStrip logos={...}` على بورد الحائط (running + finished) و**صفحات النتائج العامة**.
10. **Seed:** رعاة تجريبيون في السيناريوهات (placeholders تبقى تحتها).

## المرحلة 3 — توحيد الـ UI مع المرجع (Final Result)

11. **PublicShell:** لوجو مكدس PODIUM فوق و"BY BFT" تحته (variant جديد في BoardBrand) + خانة يمين للعداد.
12. **results-board:** كلا الصفرتين bracket بلو ألكتريك (المتغيّر: `.pb-title-cat` cyan→blue)، سلسلة `{name} /// {name}` يمين، **عداد UPDATING IN + poll عبر endpoint عام جديد** `/api/results/[series]/[category]/[division]` (منشور فقط، بلا PII — مش تلويث board API)، glow ذهبي/فضي/برونزي للصفوف والأقراص، gating عمود STUDIO بـ showStudioColumn، رفع contrast الفلاتر لـ border-strong، أنيميشن rise متدرج.
13. **صفحة الفريق:** chip الترتيب بيتلون حسب المعدن (data-rank) بدل البرونز الدائم + لينك رجوع "‹ BACK".
14. **SponsorStrip** أسفل الـ public leaderboard (فوق الـ footer).
15. **i18n:** الترجمات العربية لكل النصوص الجديدة في ar-results.ts.

## المرحلة 4 — التحقق الشامل كـ CTO

16. **اختبار السيناريوهات الأربعة:** `node scripts/walk.mjs` (جولة المسارات الموجودة) + اختبارات vitest جديدة لـ: دلالة النشر الجديدة، sponsor actions (رفض غير الأدمن، حجم الملف)، وboard API 403 لغير الأدمن.
17. **build + type-check** كاملين.
18. **فحص بصري بـ المتصفح:** (أ) زائر مسجّل خارِج يفتح /results والـ leaderboard وصفحة الفريق — لقطات، (ب) شاشة الرعاة في إعدادات الأدمن مع رفع لوجو تجريبي، (ج) بورد الحائط بالرعاة، (د) الوضع العربي RTL للصفحات العامة.

**ملفات متأثرة:** proxy.ts (لا يتغير), api/series/board/route.ts, public-results.ts, queries.ts, prisma/schema.prisma + migration, seed-scenarios.ts, lib/actions/series.ts (أو sponsors.ts جديد), api routes الجديدة, components/series/settings*, components/board/sponsor-strip.tsx, board-brand.tsx, public/results pages, results-board.tsx, globals.css, board.css, ar-results.ts, lib/board.ts