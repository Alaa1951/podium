# PODIUM — BFT MENA Brand Tokens

المصدر الرسمي: **PODIUM Series #1 Event Playbook** (صفحة الألوان — صفحة 5) + ملفات
اللوجو والخطوط المرخّصة في `Font & DOC/`. هذا الملف يمنع جلسة قادمة من إعادة
اشتقاق قيم "قريبة" بدل الرسمية.

## الألوان الرسمية

| الاسم | HEX | RGB | Pantone | قاعدة الاستخدام |
|---|---|---|---|---|
| **PODIUM Electric Blue** | `#0000FF` | R0 G0 B255 | 2728C | **للـ PODIUM Event فقط** — اللون الأعلى صوتاً: CTA، حواف التمييز، أرضية الـ auth |
| **BFT Blue** | `#00B5CC` | R0 G181 B204 | 3125C | **للـ PODIUM Program فقط** — اللون الوظيفي: focus، live/selected، روابط، labels |

> تاريخياً دخل الكود `#0000f8` و`#00b0c0` (من ملف الـ HTML المرجعي الذي يخلط
> بين القيمتين). أي قيمة غير `#0000FF`/`#00B5CC` هي خطأ — لا "تُحسَّن" القيمتان.

## التوكنز (src/app/globals.css)

### البراند
- `--podium-blue: #0000ff` — Electric Blue. لا تستخدمها كنص على أرضية داكنة
  (contrast ≈ 2:1)؛ استخدم `--podium-blue-text`.
- `--podium-blue-bright: #3b3bff` — hover، نص على الأرضية الكحلية.
- `--podium-blue-deep: #0000c2` — أرضيات صلبة (floor panel, score summary).
- `--podium-navy: #07073d` — أرضية كحلية ثابتة (viewport themeColor أيضاً).
- `--bft-cyan: #00b5cc` — BFT Blue. على أرضية فاتحة كنص: استخدم `--bft-cyan-text`.
- Accent ramp: `--color-accent-100/300/400/700/900` — 700 و500 مستعارة من
  التوكنز فوق (`var(--podium-blue)`, `var(--podium-blue-bright)`)، وليست literals.
  900 (`#000094`) أرضية الـ auth/error الثابتة. 300 (`#9a9aff`) نص/روابط على الكحلي.

### النص فوق الأرضيات الثابتة (لا تُعاد تعريفتهم في الثيم الفاتح)
`--on-navy` (نص أساسي) و`--on-navy-strong/-secondary/-muted/-faint` — كل ما
يُكتب على `--podium-navy` أو `--color-accent-900` يقرأ منهم بدل whites مكتوبة يدوياً.

### النصوص فوق tints الحالة (theme-aware)
- `--status-ok-text`, `--status-warn-text`, `--status-danger-text`, `--status-blue-text`
  — الداكن: pale (`#4ade80`…)، الفاتح: dark (`#166534`, `#854d0e`, `#b91c1c`, `--podium-blue-deep`).
- `--danger-bright: #f87171` — أحمر readable على الكحلي (رسائل خطأ الـ auth).
- `--podium-blue-text` / `--bft-cyan-text` — البراند كنص على أرضية themed.

### المعادن (المراكز الثلاثة فقط)
`--gold #c9a227`, `--silver #b9bcc0`, `--bronze #d08a4e` — والمصدر الوحيد لها
للـ TSX هو `MEDALS` في `src/lib/scoring.ts` التي تقرأها كـ `var(--gold)` إلخ.
الـ ink فوق المعدن: `--bft-ink #231f20`.

## الخطوط (src/lib/fonts.ts — ملفات مرخّصة في src/fonts/)

| المتغير | الخط | الدور |
|---|---|---|
| `--font-display` | DIN Condensed Bold 700 | عناوين الـ board والأرقام الكبيرة (`.display`) |
| `--font-heading` | D-DIN 400/700 | عناوين الواجهة، labels، أزرار، جداول |
| `--font-brand` | Futura Extra Bold 800 | **لحظات البراند الثقيلة فقط**: `.auth-title`, `.pb-title` |
| `--font-body` | Roboto 400/500/700 | الـ body كله (`body` rule في globals.css) |

ملاحظة عربية: Roboto وD-DIN بلا محارف عربية — النص العربي يقع تلقائياً على
الـ fallbacks (Segoe UI / النظام). لا تضف خطاً عربياً بدون قرار صريح.

## اللوجو (public/brand/ + Font & DOC/)

- 4 مجموعات رسمية: Hero wordmark، "PODIUM by BFT" lockup، Icon ( EPS/AI )،
  Tagline "TOGETHER WE RISE" (أسود/أبيض فقط — لا يوجد نسخة زرقاء).
- المتاح على الويب: `podium-dark-on-light.png` / `podium-light-on-dark.png` /
  `bft-dark-on-light.png` / `bft-light-on-dark.png`.
- **لا يُعاد تلوين اللوجو أبداً** — تُختار النسخة الجاهزة:
  - أرضية ثابتة داكنة (auth/board/public): `<PodiumMark tone="dark">`.
  - سطح يتبع الثيم (sidebar الكونسول): `<PodiumMark tone="auto">` مع قواعد
    `.mark-on-dark/.mark-on-light` في globals.css.
- Favicon: `src/app/icon.png` + `src/app/favicon.ico` (من الأيقونة الرسمية
  الزرقاء على أرضية navy شفافة الحواف).
- "Powered by BFT MENA" تُكتب بـ `<PoweredBy>` من `board-brand.tsx` فقط.

## قواعد سريعة

1. لا hex جديدة في TSX — token أو `var()` فقط. (الاستثناءان: `global-error.tsx`
   و`lib/email.ts` — لا يشاركان الـ CSS، لكن قيمهما يجب أن تطابق الرسمية).
2. نص على خلفية ملونة؟ تحقق من الـ contrast في **الثيمين** (WCAG AA ≥ 4.5:1).
3. الرمادي والحالات (ok/warn/danger) لهم توكنز — لا Tailwind palette literals.
4. الثيم الفاتح يعيد تعريف نفس التوكنز فقط — لا قيم جديدة.
