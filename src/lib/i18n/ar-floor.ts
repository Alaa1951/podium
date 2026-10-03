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
  "Every team in the wave needs a station before it can start.":
    "كل فريق في الموجة يحتاج محطة قبل أن تبدأ.",
  "This competition has no zones yet — add them in Settings.": "لا توجد مناطق في هذه البطولة بعد — أضفها من الإعدادات.",
  "Set the competition to Running before starting a wave.": "اجعل حالة البطولة «جارية» قبل بدء أي موجة.",
  "This wave has already started.": "هذه الموجة بدأت بالفعل.",
  "This wave is not on the floor.": "هذه الموجة ليست على أرض البطولة.",

  // ── Zone teams ─────────────────────────────────────────────────────────────
  "Zone teams": "فرق المناطق",
  "Your zone team": "فريق منطقتك",
  "Zone leader": "قائد المنطقة",
  Reserve: "احتياطي",
  "Access is per zone, for the whole competition. Each zone can have one or more leaders, who place the judges and reserves on the stations. A judge scores only the team on their station, in whichever wave is in their zone.":
    "الصلاحية على مستوى المنطقة، طوال البطولة. يمكن أن يكون لكل منطقة قائد واحد أو أكثر يوزع الحكام والاحتياطيين على المحطات. الحكم يسجل درجات الفريق الموجود على محطته فقط، في أي موجة موجودة في منطقته.",
  "No zone leader yet": "لا يوجد قائد للمنطقة بعد",
  "Nobody on this zone yet.": "لا يوجد أحد في هذه المنطقة بعد.",
  Station: "المحطة",
  "Shared station": "محطة مشتركة",
  "Make leader": "اجعله قائدًا",
  "Take {name} off this zone?": "إزالة {name} من هذه المنطقة؟",
  "Add a judge": "إضافة حكم",
  "Choose a person…": "اختر شخصًا…",
  "Search by name or email…": "ابحث بالاسم أو البريد الإلكتروني…",
  "Clear selection": "مسح الاختيار",
  "No matching people. Try another name or email.": "لا توجد نتائج مطابقة. جرّب اسمًا أو بريدًا إلكترونيًا آخر.",
  "No people available to add.": "لا يوجد أشخاص متاحون للإضافة.",
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
  "That wave is full — {n} teams, one per station.": "هذه الموجة ممتلئة — {n} فرق، فريق لكل محطة.",
  "This wave runs {n} stations — pick one of those, or raise Teams per wave in Settings.":
    "هذه الموجة تعمل بـ {n} محطات — اختر واحدة منها، أو ارفع «الفرق في الموجة» من الإعدادات.",
  "Past station {capacity}: {teams}": "بعد المحطة {capacity}: {teams}",
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
  "Open the screen for my rig": "افتح شاشة محطتي",
  "My score sheet": "ورقة درجاتي",
  "Open the screen for my zone": "افتح شاشة منطقتي",
  "Up next on this rig": "التالي على هذه المحطة",

  // ── The judge's day ────────────────────────────────────────────────────────
  "You are on Zone {zone} · Station {station}": "أنت في المنطقة {zone} · المحطة {station}",
  "You are on Zone {zone} · every station": "أنت في المنطقة {zone} · كل المحطات",
  "Coming to you next": "القادم إليك",
  "After this wave": "بعد هذه الموجة",
  "about {time}": "حوالي {time}",
  "about {time} · behind schedule": "حوالي {time} · متأخرة عن الموعد",
  "behind schedule": "متأخرة عن الموعد",
  "in {time}": "بعد {time}",
  "Estimated: the wave has not started. It moves if the floor runs late.":
    "وقت تقديري: الموجة لم تبدأ بعد، ويتأخر إذا تأخر سير البطولة.",
  "No team in this wave.": "لا يوجد فريق في هذه الموجة.",
  "No more waves are coming to your zone today.": "لا توجد موجات أخرى قادمة إلى منطقتك اليوم.",
  "Team names appear here once the competition starts.": "تظهر أسماء الفرق هنا عند بدء البطولة.",
  "Your day · {count} waves": "يومك · {count} موجات",
  "In your zone": "في منطقتك",
  Later: "لاحقًا",
  "Not checked in": "لم يسجّل حضوره",
  "Unpaid — not on the rig screen": "غير مدفوع — لا يظهر على شاشة المحطة",
  "The competition has not started yet. Scoring opens when it does — the waves coming to you are listed above.":
    "البطولة لم تبدأ بعد. يُفتح إدخال الدرجات عند بدئها — الموجات القادمة إليك معروضة في الأعلى.",
  "Waiting for your zone leader to place you on a station. Until then you see every station of your zone.":
    "بانتظار أن يضعك قائد منطقتك على محطة. حتى ذلك الحين تظهر لك كل محطات منطقتك.",
  "Scores from this wave have already been submitted, so it can no longer be reset. Ask BFT MENA.":
    "تم إرسال درجات من هذه الموجة، لذلك لم يعد ممكنًا إعادة ضبطها. تواصل مع BFT MENA.",
  "The competition can only be started on its own day. BFT MENA can start it early from Settings.":
    "لا يمكن بدء البطولة إلا في يومها. يمكن لـ BFT MENA بدؤها مبكرًا من الإعدادات.",

  // ── Marshalling ────────────────────────────────────────────────────────────
  Marshalling: "توجيه الفرق",
  "Where every wave is, where it goes next, and who to call up for the next start. Times for a wave that has not started are estimates.":
    "أين كل موجة الآن، وإلى أين تتجه بعدها، ومن يجب استدعاؤه للبداية القادمة. أوقات الموجة التي لم تبدأ تقديرية.",
  "The competition has not started yet. The call-up below follows the planned start times.":
    "البطولة لم تبدأ بعد. الاستدعاء أدناه يتبع مواعيد البداية المخططة.",
  "Zones now": "المناطق الآن",
  "Next in: {wave} at {time}": "التالية: {wave} الساعة {time}",
  "Moving next": "الانتقال القادم",
  "finishes at {time}": "تنتهي الساعة {time}",
  "→ {zone} at {time}": "← {zone} الساعة {time}",
  Stations: "المحطات",
  "Call-up": "الاستدعاء",
  "No more waves to call up.": "لا توجد موجات أخرى للاستدعاء.",
  "starts about {time} — gather at Zone 1": "تبدأ حوالي {time} — التجمع عند المنطقة 1",
  "{checked} of {total} checked in": "سجّل {checked} من {total} حضورهم",
  "Undo check-in": "إلغاء تسجيل الحضور",

  // ── T-shirts ───────────────────────────────────────────────────────────────
  "T-shirts": "التيشيرتات",
  "One shirt per athlete on an entered team. The waiting list is counted apart, not in the order.":
    "تيشيرت واحد لكل رياضي في فريق مسجّل. قائمة الانتظار تُحسب منفصلة وليست ضمن الطلب.",
  "Download CSV": "تنزيل ملف CSV",
  "To order": "المطلوب طباعته",
  "Entered teams": "الفرق المسجّلة",
  "{count} athletes have no size yet — see the list below.": "{count} رياضيين بلا مقاس حتى الآن — راجع القائمة أدناه.",
  "By gym": "حسب الجيم",
  Gym: "الجيم",
  "By category and level": "حسب الفئة والمستوى",
  "No size given": "بدون مقاس",
  "Signed up, not on a team yet": "مسجّلون ولم ينضموا إلى فريق بعد",
  "Not counted in the order until they are on a team.": "لا يُحسبون في الطلب حتى ينضموا إلى فريق.",
  Size: "المقاس",

  // ── The athlete's day ──────────────────────────────────────────────────────
  "Your day": "يومك",
  "Not checked in yet": "لم يُسجَّل حضوركم بعد",
  "You keep the same station in every zone. Be at Zone 1 before your wave starts.":
    "تبقون على نفس المحطة في كل المناطق. كونوا عند المنطقة 1 قبل بدء موجتكم.",
  Now: "الآن",
  "T-shirt: {size}": "التيشيرت: {size}",
};
