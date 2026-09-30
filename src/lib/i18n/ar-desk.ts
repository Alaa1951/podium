import type { Phrases } from "@/lib/i18n/phrases";

/** The desks of the day: entrance check-in, warm-up check-in, and changing a team's category or level. */
export const AR_DESK: Phrases = {
  // ── Entrance check-in ──────────────────────────────────────────────────────
  "Entrance check-in": "تسجيل الحضور عند الدخول",
  "Who has arrived at the venue. Check in each athlete as they arrive, or the whole team at once. A team counts as checked in only when everyone on it is here.":
    "من وصل إلى مكان البطولة. سجّل حضور كل رياضي عند وصوله، أو الفريق كله مرة واحدة. لا يُحسب الفريق حاضرًا إلا عند وصول كل أعضائه.",
  "These are your studio's teams only.": "هذه فرق الاستوديو الخاص بك فقط.",
  "Checked-in teams": "الفرق الحاضرة",
  "Teams not yet checked in": "فرق لم يكتمل حضورها",
  "everyone on the team is here": "كل أعضاء الفريق حاضرون",
  "{count} partly arrived": "{count} وصل جزء منها",
  "Registered athletes": "الرياضيون المسجلون",
  "Checked-in athletes": "الرياضيون الحاضرون",
  "Athletes not yet checked in": "رياضيون لم يحضروا بعد",
  "people at the venue": "أشخاص في مكان البطولة",
  "Teams: {in} of {total} checked in": "الفرق: حضر {in} من {total}",
  "Athletes: {in} of {total} checked in": "الرياضيون: حضر {in} من {total}",
  "Search team, athlete or team number…": "ابحث باسم الفريق أو الرياضي أو رقم الفريق…",
  "Search check-in": "البحث في تسجيل الحضور",
  "Check-in status": "حالة الحضور",
  "Any check-in status": "كل حالات الحضور",
  "Not yet checked in": "لم يكتمل حضوره",
  "Partly arrived": "حضور جزئي",
  "Partly arrived — {here} of {total}": "حضور جزئي — {here} من {total}",
  Arrived: "وصل",
  "Not arrived": "لم يصل",
  Unpaid: "غير مدفوع",
  Undo: "تراجع",
  "Check in whole team": "تسجيل حضور الفريق كله",
  "Undo team check-in": "إلغاء حضور الفريق",
  "No teams to check in yet.": "لا توجد فرق لتسجيل حضورها بعد.",
  "Clear the search or the filters.": "امسح البحث أو الفلاتر.",

  // ── Warm-up check-in ───────────────────────────────────────────────────────
  "Warm-up check-in": "تسجيل الجاهزية في الإحماء",
  "Which teams are ready to compete, wave by wave. Mark a team ready once its warm-up and preparation are complete. Arriving at the venue is recorded at the entrance and is shown here for reference only.":
    "الفرق الجاهزة للمنافسة، موجة بموجة. علّم الفريق جاهزًا بعد اكتمال إحمائه واستعداده. الوصول إلى المكان يُسجَّل عند الدخول ويظهر هنا للاطلاع فقط.",
  "Ready teams": "الفرق الجاهزة",
  "Pending teams": "فرق لم تجهز بعد",
  "marked ready in warm-up": "تم تأكيد جاهزيتها في الإحماء",
  "not marked ready yet": "لم تُؤكَّد جاهزيتها بعد",
  "{count} ready team(s) are not fully checked in at the entrance. Readiness does not check anyone in.":
    "{count} من الفرق الجاهزة لم يكتمل حضورها عند الدخول. تأكيد الجاهزية لا يسجّل حضور أحد.",
  "Search warm-up": "البحث في الإحماء",
  Readiness: "الجاهزية",
  "Ready and pending": "الجاهز وغير الجاهز",
  Ready: "جاهز",
  "Not ready yet": "غير جاهز بعد",
  "Not in a wave yet": "بدون موجة بعد",
  "{count} ready": "{count} جاهز",
  "{count} pending": "{count} غير جاهز",
  Entrance: "الدخول",
  "Warm-up": "الإحماء",
  "Mark ready": "تأكيد الجاهزية",
  "Undo ready": "إلغاء الجاهزية",
  "Ready to compete": "جاهز للمنافسة",

  // ── Changing a team's category or level ────────────────────────────────────
  "Category and level": "الفئة والمستوى",
  "Change category or level": "تغيير الفئة أو المستوى",
  "Category / level…": "الفئة / المستوى…",
  "You can change it yourself until {when} (Qatar time). After that, ask BFT MENA at the desk.":
    "يمكنك تغييرها بنفسك حتى {when} (بتوقيت قطر). بعد ذلك اطلب من BFT MENA عند مكتب التسجيل.",
  "Only at the athlete's request. Open until a score is entered for the team.": "بطلب من الرياضي فقط. متاح حتى تُسجَّل درجة للفريق.",
  "Only at the athlete's request. Open until {when} (Qatar time); after that, BFT MENA changes it.":
    "بطلب من الرياضي فقط. متاح حتى {when} (بتوقيت قطر)؛ بعد ذلك التغيير عن طريق BFT MENA.",
  "Changes to your category and level closed on {when} (Qatar time). BFT MENA can still change it for you until your team has a score — ask at the desk.":
    "أُغلق تغيير الفئة والمستوى في {when} (بتوقيت قطر). ما زال بإمكان BFT MENA تغييرها لك حتى تُسجَّل درجة لفريقك — اطلب ذلك عند مكتب التسجيل.",
  "Changes to this team's category and level closed on {when} (Qatar time). BFT MENA can still change it until the team has a score.":
    "أُغلق تغيير فئة هذا الفريق ومستواه في {when} (بتوقيت قطر). ما زال بإمكان BFT MENA تغييرها حتى تُسجَّل درجة للفريق.",
  "Athletes and their gym may also change the team's category and level until then. After it, BFT MENA and event staff still can, until a score is entered for the team.":
    "يمكن للرياضيين والجيم الخاص بهم تغيير فئة الفريق ومستواه حتى هذا الموعد أيضًا. وبعده يبقى التغيير متاحًا لـ BFT MENA وطاقم البطولة حتى تُسجَّل درجة للفريق.",
  "To change your category or level, ask your studio or BFT MENA.": "لتغيير فئتك أو مستواك، اطلب من الاستوديو الخاص بك أو من BFT MENA.",
  "Womens is not available: a member of this team is registered as a man.": "فئة السيدات غير متاحة: أحد أعضاء الفريق مسجَّل كرجل.",
  "Mens is not available: a member of this team is registered as a woman.": "فئة الرجال غير متاحة: إحدى عضوات الفريق مسجَّلة كسيدة.",
  "Moving into or out of Pro is done by BFT MENA.": "الانتقال إلى مستوى المحترفين أو منه يتم عن طريق BFT MENA.",
  "The team will be listed and ranked with the {bracket} teams.": "سيُدرج الفريق ويُرتَّب مع فرق {bracket}.",
  "Its team number, wave, station, payment and check-in stay as they are.": "رقم الفريق والموجة والمحطة والدفع وتسجيل الحضور تبقى كما هي.",
  "Now: {bracket}. Choose a different category or level.": "الحالي: {bracket}. اختر فئة أو مستوى مختلفًا.",
  "The athlete asked for this change and approves it.": "الرياضي طلب هذا التغيير ويوافق عليه.",
  "Your name, the time and the old and new values are recorded with this change.": "يُسجَّل اسمك والوقت والقيم القديمة والجديدة مع هذا التغيير.",
  "Confirm that the athlete asked for this change and approves it.": "أكّد أن الرياضي طلب هذا التغيير ويوافق عليه.",
  "Save change": "حفظ التغيير",
  "Saved. The team is now {bracket}.": "تم الحفظ. الفريق الآن في {bracket}.",
  "Your wave has started, so your category and level cannot change now.": "بدأت موجتك، لذلك لا يمكن تغيير الفئة أو المستوى الآن.",
  "Your team has a score, so your category and level cannot change now.": "لفريقك درجة مسجَّلة، لذلك لا يمكن تغيير الفئة أو المستوى الآن.",
  "This team's wave has started, so its category and level cannot change now.": "بدأت موجة هذا الفريق، لذلك لا يمكن تغيير فئته أو مستواه الآن.",
  "This team has a score, so its category and level cannot change now.": "لهذا الفريق درجة مسجَّلة، لذلك لا يمكن تغيير فئته أو مستواه الآن.",
  "This team's category or level changed while this was open. Reload to see it as it is now.":
    "تغيّرت فئة هذا الفريق أو مستواه أثناء فتح هذه النافذة. أعد التحميل لرؤيته كما هو الآن.",
  "You are signed out. Sign in and try again.": "انتهت جلستك. سجّل الدخول وحاول مرة أخرى.",
  "To change the level at the athlete's request, use Category / level on the team.": "لتغيير المستوى بطلب من الرياضي، استخدم «الفئة / المستوى» في صفحة الفريق.",
  "The pairs your studio entered in this competition. Correct a name here. When an athlete asks to change category or level, use Category / level on their team; a move into or out of Pro comes from BFT MENA.":
    "الفرق التي سجّلها الاستوديو الخاص بك في هذه البطولة. صحّح الاسم من هنا. وعندما يطلب رياضي تغيير الفئة أو المستوى، استخدم «الفئة / المستوى» في فريقه؛ أما الانتقال إلى مستوى المحترفين أو منه فيتم عن طريق BFT MENA.",
};
