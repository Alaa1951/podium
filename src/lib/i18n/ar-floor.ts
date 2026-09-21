import type { Phrases } from "@/lib/i18n/phrases";

/** The floor: stations, zone timing, wave control, zone teams, the judge sheet. */
export const AR_FLOOR: Phrases = {
  // ── Wave control ───────────────────────────────────────────────────────────
  "Press Start once per wave. It then moves through every zone by itself: {work} minutes of work, {break} minutes to change zones, no changeover after the last zone. A new wave can start as soon as Zone 1 is free.":
    "اضغط «ابدأ» مرة واحدة لكل موجة، وبعدها تنتقل بين كل المناطق تلقائيًا: {work} دقيقة عمل، ثم {break} دقائق للانتقال بين المناطق، ولا يوجد انتقال بعد آخر منطقة. يمكن بدء موجة جديدة بمجرد أن تفرغ المنطقة 1.",
  "Waves can only be started while the competition is running. Set it to Running in Settings first.":
    "لا يمكن بدء الموجات إلا أثناء سير البطولة. اجعل حالتها «جارية» من الإعدادات أولًا.",
  "End this wave now? Teams not stopped keep the time left on the clock.":
    "إنهاء هذه الموجة الآن؟ الفرق التي لم تُوقف تحتفظ بالوقت المتبقي على الساعة.",
  "Put this wave back to not started? Scores already entered are kept.":
    "إرجاع هذه الموجة إلى «لم تبدأ»؟ الدرجات المُدخلة تبقى كما هي.",
  "Zone 1 is still busy — free in {time}.": "المنطقة 1 ما زالت مشغولة — تفرغ بعد {time}.",
  "{minutes} min per wave": "{minutes} دقيقة لكل موجة",
  "Zone 1 free in {time}": "المنطقة 1 تفرغ بعد {time}",
  "Zone 1 is free": "المنطقة 1 فارغة",
  Working: "قيد العمل",
  "Changing zones": "انتقال بين المناطق",
  "changing zones": "انتقال بين المناطق",
  Empty: "فارغة",
  "{zone} · working · {time} left": "{zone} · قيد العمل · متبقي {time}",
  "Changing zones · {time}": "انتقال بين المناطق · {time}",
  Finishing: "على وشك الانتهاء",
  "wave {time}": "الموجة {time}",
  "Without a station: {teams}": "بدون محطة: {teams}",
  "Start · Zone 1 free in {time}": "ابدأ · المنطقة 1 تفرغ بعد {time}",
  "End now": "إنهاء الآن",
  Reset: "إعادة ضبط",
  "No waves yet. Build the running order on the Waves screen.": "لا توجد موجات بعد. جهّز ترتيب الموجات من شاشة الموجات.",
  "This wave has no teams yet.": "لا توجد فرق في هذه الموجة بعد.",
  "Every team in the wave needs a station (1–9) before it can start.":
    "كل فريق في الموجة يحتاج محطة (من 1 إلى 9) قبل أن تبدأ.",
  "This competition has no zones yet — add them in Settings.": "لا توجد مناطق في هذه البطولة بعد — أضفها من الإعدادات.",
  "Set the competition to Running before starting a wave.": "اجعل حالة البطولة «جارية» قبل بدء أي موجة.",
  "This wave has already started.": "هذه الموجة بدأت بالفعل.",
  "This wave is not on the floor.": "هذه الموجة ليست على أرض البطولة.",

  // ── Zone teams ─────────────────────────────────────────────────────────────
  "Zone teams": "فرق المناطق",
  "Your zone team": "فريق منطقتك",
  "Zone leader": "قائد المنطقة",
  Reserve: "احتياطي",
  "Access is per zone, for the whole competition. Each zone has one leader, who places the judges and reserves on stations 1–9. A judge scores only the team on their station, in whichever wave is in their zone.":
    "الصلاحية على مستوى المنطقة، طوال البطولة. لكل منطقة قائد واحد يوزع الحكام والاحتياطيين على المحطات من 1 إلى 9. الحكم يسجل درجات الفريق الموجود على محطته فقط، في أي موجة موجودة في منطقته.",
  "No zone leader yet": "لا يوجد قائد للمنطقة بعد",
  "Nobody on this zone yet.": "لا يوجد أحد في هذه المنطقة بعد.",
  Station: "المحطة",
  "Shared station": "محطة مشتركة",
  "Make leader": "اجعله قائدًا",
  "Take {name} off this zone?": "إزالة {name} من هذه المنطقة؟",
  "Add a judge": "إضافة حكم",
  "Choose a person…": "اختر شخصًا…",
  As: "بصفة",
  "Nobody holds the Judge role yet. Give it to people from their Access panel first.":
    "لا أحد يحمل دور الحكم بعد. امنحه للأشخاص من لوحة الصلاحيات أولًا.",
  "That person does not hold the Judge role. Give it to them first.": "هذا الشخص لا يحمل دور الحكم. امنحه له أولًا.",
  "That person or zone no longer exists.": "هذا الشخص أو المنطقة لم يعد موجودًا.",

  // ── The judge sheet ────────────────────────────────────────────────────────
  "Submit Zone {zone} for {team}? It locks once submitted.": "إرسال المنطقة {zone} لفريق {team}؟ ستُقفل بعد الإرسال.",
  "Submit zone": "إرسال المنطقة",
  Submitted: "تم الإرسال",
  Open: "مفتوحة",
  "You are not on a zone yet.": "لم يتم وضعك في أي منطقة بعد.",
  "The supervisor puts judges on zones from Wave control, and your zone leader places you on a station.":
    "المشرف يضع الحكام في المناطق من شاشة التحكم في الموجات، وقائد منطقتك يضعك على محطة.",
  "The team on your station, in whichever wave is in your zone. It changes by itself when the next wave arrives.":
    "الفريق الموجود على محطتك، في أي موجة موجودة في منطقتك. يتغير تلقائيًا عند وصول الموجة التالية.",
  "Station {station}": "المحطة {station}",
  "No station yet": "لا توجد محطة بعد",
  "The competition has not started yet. Your sheet opens when it does.": "لم تبدأ البطولة بعد. ستفتح ورقتك عند بدايتها.",
  "Waiting for your zone leader to place you on a station.": "بانتظار أن يضعك قائد منطقتك على محطة.",
  "working · {time} left": "قيد العمل · متبقي {time}",
  "changing zones · {time}": "انتقال بين المناطق · {time}",
  "No team on your station in this wave.": "لا يوجد فريق على محطتك في هذه الموجة.",
  "Waiting for the next wave to reach your zone.": "بانتظار وصول الموجة التالية إلى منطقتك.",
  "Still to submit from earlier waves": "ما زال بحاجة للإرسال من موجات سابقة",
  "This zone is submitted and locked. Ask BFT MENA for any correction.": "هذه المنطقة أُرسلت وأُقفلت. اطلب أي تصحيح من بي إف تي مينا.",
  "This team is not on your station.": "هذا الفريق ليس على محطتك.",
  "Your zone leader has not placed you on a station yet.": "لم يضعك قائد منطقتك على محطة بعد.",
  "This wave has not reached your zone yet.": "هذه الموجة لم تصل إلى منطقتك بعد.",
  "The competition is not running.": "البطولة ليست جارية.",
  "Fill in every field before submitting.": "املأ كل الحقول قبل الإرسال.",
  "A value is out of range.": "إحدى القيم خارج النطاق المسموح.",
  "You are not allowed to score this.": "غير مسموح لك بتسجيل هذه الدرجة.",

  // ── Console, settings, schedule ────────────────────────────────────────────
  "Every team on one sheet. The judges submit each zone from their own sheet, and it shows here locked. Starting and ending waves is on Wave control.":
    "كل الفرق في ورقة واحدة. الحكام يرسلون كل منطقة من أوراقهم، وتظهر هنا مقفلة. بدء الموجات وإنهاؤها من شاشة التحكم في الموجات.",
  "Submitted by the zone judge — locked": "أرسلها حكم المنطقة — مقفلة",
  "The supervisor presses Start once and the wave moves through every zone by itself: the work time in each zone, then the changeover, with no changeover after the last zone. Each team keeps one station (1–9) in every zone.":
    "المشرف يضغط «ابدأ» مرة واحدة وتنتقل الموجة بين كل المناطق تلقائيًا: وقت العمل في كل منطقة، ثم الانتقال، ولا يوجد انتقال بعد آخر منطقة. كل فريق يحتفظ بمحطة واحدة (من 1 إلى 9) في كل المناطق.",
  "Work per zone (minutes)": "العمل في كل منطقة (بالدقائق)",
  "Changeover between zones (minutes)": "الانتقال بين المناطق (بالدقائق)",
  "one per station, nine at most": "فريق لكل محطة، تسعة كحد أقصى",
  "Each wave runs {minutes} minutes across {zones} zones.": "كل موجة تستمر {minutes} دقيقة عبر {zones} مناطق.",
  "That wave is full — nine teams, one per station.": "هذه الموجة ممتلئة — تسعة فرق، فريق لكل محطة.",
  "Another studio's team is on that station.": "يوجد فريق لاستوديو آخر على هذه المحطة.",
  "The floor holds nine teams at once, one per station, so the field is dealt into waves. Each team keeps its station in every zone. Timing comes from the competition settings; each wave carries its own estimated start.":
    "أرض البطولة تتسع لتسعة فرق في نفس الوقت، فريق لكل محطة، لذلك تُوزع الفرق على موجات. كل فريق يحتفظ بمحطته في كل المناطق. التوقيت من إعدادات البطولة، ولكل موجة موعد بداية تقديري خاص بها.",

  // ── The screens over the rigs ──────────────────────────────────────────────
  "Screens for the floor": "شاشات أرض البطولة",
  "Open one on the screen above each rig. It follows the wave in that zone by itself.":
    "افتح واحدة على الشاشة فوق كل محطة، وستتابع الموجة في تلك المنطقة تلقائيًا.",
  Unscheduled: "خارج الجدول",
  "These teams point at Wave {n}, which is not in the running order. Add that wave, or move them.":
    "هذه الفرق مرتبطة بالموجة {n} وهي غير موجودة في الجدول. أضف تلك الموجة أو انقل الفرق.",
  Changeover: "فترة التبديل",
  "No wave in this zone right now.": "لا توجد موجة في هذه المنطقة الآن.",
  "This rig is not in use for this wave.": "هذه المحطة غير مستخدمة في هذه الموجة.",
};
