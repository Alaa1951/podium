import type { Phrases } from "@/lib/i18n/phrases";

/** The category schedule, Auto Assign by category, and moving a team by hand. */
export const AR_SCHEDULE: Phrases = {
  // ── Settings → Category schedule ───────────────────────────────────────────
  "Category schedule": "جدول الفئات",
  "Each category runs in its own block, in this order. Its start is fixed; its break begins when its last wave finishes and is kept whole before the next category starts. Auto Assign places each team only in its own category's block, and never moves a start or shortens a break to make the day fit.":
    "تُقام كل فئة في فترة خاصة بها وبهذا الترتيب. موعد بدايتها ثابت، واستراحتها تبدأ عند انتهاء آخر موجة فيها وتُحفظ كاملة قبل بدء الفئة التالية. التوزيع التلقائي يضع كل فريق في فترة فئته فقط، ولا يغيّر أي موعد بداية ولا يقصّر أي استراحة ليتّسع اليوم.",
  "Times are on {day}, Qatar time.": "المواعيد في يوم {day} بتوقيت قطر.",
  "Starts at": "تبدأ في",
  "{category} starts at": "موعد بدء {category}",
  "Break after (minutes)": "الاستراحة بعدها (دقائق)",
  "Break after {category} (minutes)": "الاستراحة بعد {category} (دقائق)",
  "Move {category} earlier": "تقديم {category}",
  "Move {category} later": "تأخير {category}",
  Preview: "معاينة",
  "Give every category a start time and a break to see the day. Until then Auto Assign stays off and the current waves are left as they are.":
    "حدّد موعد بدء واستراحة لكل فئة لترى اليوم. حتى ذلك الحين يبقى التوزيع التلقائي متوقفًا وتبقى الموجات الحالية كما هي.",
  "Give every category a start time and a break.": "حدّد موعد بدء واستراحة لكل فئة.",
  "Check the times: a start is HH:mm, a break is 0 to 720 minutes.": "راجع المواعيد: البداية بصيغة HH:mm، والاستراحة من 0 إلى 720 دقيقة.",
  "This competition is no longer available.": "هذه البطولة لم تعد متاحة.",
  "Save category schedule": "حفظ جدول الفئات",
  "Saved. Resolve the conflicts below before running Auto Assign.": "تم الحفظ. عالج التعارضات أدناه قبل تشغيل التوزيع التلقائي.",
  "Saved. Auto Assign will lay the day out by these times; nobody has moved yet.": "تم الحفظ. سيوزّع التوزيع التلقائي اليوم حسب هذه المواعيد؛ لم يُنقل أحد بعد.",
  "Only whoever builds the running order (Waves: create waves and set times) can change this.":
    "يغيّر هذا فقط من يبني ترتيب الموجات (الموجات: إنشاء الموجات وتحديد المواعيد).",

  // ── The summary ────────────────────────────────────────────────────────────
  "Estimated finish": "الانتهاء المتوقع",
  "Break after": "الاستراحة بعدها",
  "Next category from": "الفئة التالية من",
  "1 team": "فريق واحد",
  "{count} teams": "{count} فرق",
  "1 wave": "موجة واحدة",
  "{count} waves": "{count} موجات",
  "Also runs other categories' teams here: {teams}": "يشارك هنا أيضًا فرق من فئات أخرى: {teams}",
  "Runs outside this block: {teams}": "يشارك خارج هذه الفترة: {teams}",
  Conflict: "تعارض",
  Fits: "مناسب",
  "Every category fits, with its full break before the next one.": "كل فئة تتّسع، مع استراحتها كاملة قبل الفئة التالية.",
  "{minutes} min": "{minutes} د",
  "{hours} h": "{hours} س",
  "{hours} h {minutes} min": "{hours} س {minutes} د",

  // ── Conflicts ──────────────────────────────────────────────────────────────
  "This competition has no zones yet, so a wave's length cannot be worked out. Add zones in Settings → Scoring.":
    "لا توجد مناطق في هذه البطولة بعد، فلا يمكن حساب مدة الموجة. أضف المناطق من الإعدادات ← التسجيل.",
  "The schedule needs {waves} waves; at most 99 are possible. Raise the teams per wave.":
    "يحتاج الجدول إلى {waves} موجة، والحد الأقصى 99. ارفع عدد الفرق في كل موجة.",
  "{category} finishes about {finish}. With its {break} break, {next} can start at {earliest} at the earliest — it is set to {start}, {short} too early.":
    "تنتهي {category} نحو {finish}. ومع استراحتها ({break}) لا يمكن أن تبدأ {next} قبل {earliest} — بينما موعدها {start}، أي قبل الموعد الممكن بـ{short}.",
  "Required: {required} from the {category} start (competition and break). Available: {available}. Places in time: {fit} for {teams} teams.":
    "المطلوب: {required} من بداية {category} (المنافسة والاستراحة). المتاح: {available}. الأماكن المتاحة في الوقت: {fit} لـ{teams} فريقًا.",
  "Waves holding teams running manually that finish too late on their own: {waves}.": "موجات فيها فرق تُدار يدويًا تنتهي متأخرة وحدها: {waves}.",
  "{category} would finish at {finish}, after midnight. The competition day ends at 24:00.": "ستنتهي {category} في {finish}، بعد منتصف الليل. يوم البطولة ينتهي عند 24:00.",
  "Wave {wave} ({time}) holds teams running manually ({teams}) but starts before the {category} block ({blockStart}).":
    "الموجة {wave} ({time}) فيها فرق تُدار يدويًا ({teams}) لكنها تبدأ قبل فترة {category} ({blockStart}).",
  "Wave {wave} ({time}) holds teams running manually ({teams}) before the first category starts.":
    "الموجة {wave} ({time}) فيها فرق تُدار يدويًا ({teams}) قبل بدء الفئة الأولى.",
  "Wave {wave} holds teams running manually on stations past {capacity} per wave ({teams}).":
    "الموجة {wave} فيها فرق تُدار يدويًا على محطات بعد {capacity} في الموجة ({teams}).",
  "Resolve these teams first: move them to a slot that fits, or return them to Auto Assign on the Waves screen. Nothing was changed.":
    "عالج وضع هذه الفرق أولًا: انقلها إلى مكان مناسب، أو أعدها إلى التوزيع التلقائي من شاشة الموجات. لم يتغيّر شيء.",
  "Some teams stand on stations past that many teams per wave. Move them first.": "بعض الفرق على محطات بعد هذا العدد في الموجة. انقلها أولًا.",

  // ── Waves: Auto Assign ─────────────────────────────────────────────────────
  "The floor holds nine teams at once, one per station, so the field is dealt into waves. Each team keeps its station in every zone. Each category runs in its own block of the day (Settings → Category schedule); each wave carries its own estimated start.":
    "تتسع الأرضية لتسعة فرق في وقت واحد، فريق لكل محطة، لذلك تُوزَّع الفرق على موجات. يحتفظ كل فريق بمحطته في كل المناطق. تُقام كل فئة في فترة خاصة بها من اليوم (الإعدادات ← جدول الفئات)، ولكل موجة موعد بداية تقديري.",
  "No category schedule yet.": "لا يوجد جدول فئات بعد.",
  "Auto Assign places each category in its own block, so it needs every category's start time and break first. The current waves are kept as they are.":
    "يضع التوزيع التلقائي كل فئة في فترتها، لذلك يحتاج أولًا إلى موعد بدء واستراحة لكل فئة. تبقى الموجات الحالية كما هي.",
  "Settings → Category schedule": "الإعدادات ← جدول الفئات",
  "Auto Assign places Men, Mixed and Women only in their own blocks, Rookie, Open, Pro within each; it never fills a block with another category's teams. Teams running manually stay exactly where they are. Below is what it would do now.":
    "يضع التوزيع التلقائي الرجال والمختلط والسيدات كلًّا في فترته فقط، المبتدئ ثم المفتوح ثم المحترف داخل كل فئة، ولا يملأ فترة بفرق من فئة أخرى أبدًا. تبقى الفرق التي تُدار يدويًا في أماكنها تمامًا. وفيما يلي ما سيفعله الآن.",
  "Reassign every team that is not running manually? {count} team(s) running manually keep their wave and station.":
    "إعادة توزيع كل فريق لا يُدار يدويًا؟ تحتفظ {count} من الفرق التي تُدار يدويًا بموجتها ومحطتها.",
  "Reassign every team by the category schedule? Current waves and stations are replaced.": "إعادة توزيع كل الفرق حسب جدول الفئات؟ ستُستبدل الموجات والمحطات الحالية.",
  "Done. Every category runs in its own block; teams running manually were left in place.": "تم. كل فئة في فترتها؛ وبقيت الفرق التي تُدار يدويًا في أماكنها.",
  "Auto Assign did not run: the day does not fit. Nothing was changed.": "لم يُشغَّل التوزيع التلقائي: اليوم لا يتّسع. لم يتغيّر شيء.",
  "{category} block": "فترة {category}",
  "No category block": "خارج فترات الفئات",
  "no category block": "خارج فترات الفئات",
  "This wave holds teams running manually ({teams}). Move them or return them to Auto Assign first.":
    "هذه الموجة فيها فرق تُدار يدويًا ({teams}). انقلها أو أعدها إلى التوزيع التلقائي أولًا.",
  "Wave {wave} holds teams running manually ({teams}). Change its number or time anyway? They move with it.":
    "الموجة {wave} فيها فرق تُدار يدويًا ({teams}). هل تغيّر رقمها أو موعدها رغم ذلك؟ ستنتقل معها.",

  // ── A team on the running order ────────────────────────────────────────────
  "Running Manually": "يُدار يدويًا",
  "Move…": "نقل…",
  "Place…": "تعيين…",
  "Return to Auto Assign": "إعادة إلى التوزيع التلقائي",
  "Runs in the {block} block — competes, is ranked and awarded as {category} {division}.":
    "يشارك في فترة {block} — ويُنافس ويُرتَّب ويُكرَّم ضمن {category} {division}.",
  "Runs outside the category schedule — competes, is ranked and awarded as {category} {division}.":
    "يشارك خارج جدول الفئات — ويُنافس ويُرتَّب ويُكرَّم ضمن {category} {division}.",
  "Finishes after the {category} awards period begins ({from}–{to}): {category} results are not complete until this wave ends.":
    "ينتهي بعد بدء فترة تكريم {category} ({from}–{to}): لا تكتمل نتائج {category} حتى تنتهي هذه الموجة.",
  "Runs in the {block} block — competes as {category}": "يشارك في فترة {block} — يُنافس ضمن {category}",
  "Runs outside the category schedule — competes as {category}": "يشارك خارج جدول الفئات — يُنافس ضمن {category}",

  // ── The move panel ─────────────────────────────────────────────────────────
  "Move #{number} {name}": "نقل #{number} {name}",
  "not in a wave": "ليس في موجة",
  "To wave": "إلى الموجة",
  full: "ممتلئة",
  "Lowest free ({station})": "أول محطة فارغة ({station})",
  "The team will run manually: Auto Assign keeps it in exactly this slot until it is returned to Auto Assign.":
    "سيُدار الفريق يدويًا: يُبقيه التوزيع التلقائي في هذا المكان تمامًا حتى يُعاد إلى التوزيع التلقائي.",
  "Its category, level, results, ranking and awards stay {category} {division}; its check-in and warm-up status are kept.":
    "تبقى فئته ومستواه ونتائجه وترتيبه وتكريمه ضمن {category} {division}، ويُحتفظ بتسجيل حضوره وجاهزيته في الإحماء.",
  "Scheduling exception: this {category} team would run in the {block}.": "استثناء في الجدول: سيشارك فريق {category} هذا في {block}.",
  "Tick to confirm. It is shown as running outside its category's block.": "ضع علامة للتأكيد. سيظهر على أنه يشارك خارج فترة فئته.",
  "This wave finishes at {finish}, after the {category} awards period begins ({from}–{to}).": "تنتهي هذه الموجة في {finish}، بعد بدء فترة تكريم {category} ({from}–{to}).",
  "This wave finishes after the {category} awards period begins ({from}–{to}).": "تنتهي هذه الموجة بعد بدء فترة تكريم {category} ({from}–{to}).",
  "{category} results will not be complete at its awards. Tick to confirm you have planned for that.": "لن تكتمل نتائج {category} وقت تكريمها. ضع علامة لتأكيد أنك خطّطت لذلك.",
  "Confirm move": "تأكيد النقل",
  "#{number} {name} now runs manually in wave {wave}.": "#{number} {name} يُدار الآن يدويًا في الموجة {wave}.",
  "The team already stands there.": "الفريق موجود هناك بالفعل.",
  "That station was just taken. Choose another.": "حُجزت هذه المحطة للتو. اختر غيرها.",
  "A team running manually stands on that station.": "على هذه المحطة فريق يُدار يدويًا.",
  "This team has a recorded score, so it cannot move.": "لهذا الفريق درجة مسجّلة، فلا يمكن نقله.",
  "This team is on the waiting list and holds no place.": "هذا الفريق في قائمة الانتظار ولا يملك مكانًا.",
  "That wave does not have that station.": "هذه الموجة لا تحتوي هذه المحطة.",
  "Confirm the scheduling exception to move the team there.": "أكّد الاستثناء في الجدول لنقل الفريق إلى هناك.",
  "Confirm the awards warning to move the team there.": "أكّد تنبيه التكريم لنقل الفريق إلى هناك.",
  "Return #{number} {name} to Auto Assign?": "إعادة #{number} {name} إلى التوزيع التلقائي؟",
  "It stays in wave {wave}, station {station}, for now. The next Auto Assign run may move it to any slot of its own category's block.":
    "يبقى الآن في الموجة {wave}، المحطة {station}. وقد ينقله التوزيع التلقائي القادم إلى أي مكان في فترة فئته.",
  "The next Auto Assign run may move it to any slot of its own category's block.": "قد ينقله التوزيع التلقائي القادم إلى أي مكان في فترة فئته.",
  "Keep running manually": "إبقاؤه يُدار يدويًا",
  "#{number} {name} is back with Auto Assign.": "عاد #{number} {name} إلى التوزيع التلقائي.",
  "An approved move runs manually: Auto Assign keeps the team in this slot.": "النقل المعتمد يُدار يدويًا: يُبقي التوزيع التلقائي الفريق في هذا المكان.",

  // ── Refusals ───────────────────────────────────────────────────────────────
  "Set every category's start time and break in Settings → Category schedule first. The current waves were kept.":
    "حدّد موعد بدء واستراحة كل فئة من الإعدادات ← جدول الفئات أولًا. بقيت الموجات الحالية كما هي.",
  "This competition has a category schedule: Auto Assign lays out the times of each block.": "لهذه البطولة جدول فئات: يحدد التوزيع التلقائي مواعيد كل فترة.",
  "Scores have been recorded, so the running order cannot be rebuilt.": "سُجّلت درجات، فلا يمكن إعادة بناء ترتيب الموجات.",
  "This wave holds teams running manually. Confirm to change it.": "هذه الموجة فيها فرق تُدار يدويًا. أكّد لتغييرها.",
  "Teams running manually are in the way. Move them or return them to Auto Assign first. Nothing was changed.":
    "هناك فرق تُدار يدويًا تمنع ذلك. انقلها أو أعدها إلى التوزيع التلقائي أولًا. لم يتغيّر شيء.",
  "This team runs manually in another category's block. Move it, or return it to Auto Assign on the Waves screen, before changing its category.":
    "هذا الفريق يُدار يدويًا في فترة فئة أخرى. انقله أو أعده إلى التوزيع التلقائي من شاشة الموجات قبل تغيير فئته.",
  "Your team's wave was arranged by hand. Ask at the desk to change your category.": "رُتّبت موجة فريقك يدويًا. اطلب تغيير فئتك من مكتب التسجيل.",
  // ── Exchanging places, and why a move cannot happen ───────────────────────
  "Wave {wave} has started: the team stays in it. Reset the wave on Wave control first to move it (only before any zone is submitted).":
    "بدأت الموجة {wave}: يبقى الفريق فيها. لنقله أعد ضبط الموجة من التحكم في الموجات أولًا (ممكن فقط قبل اعتماد أي منطقة).",
  "A zone of this team's score is submitted: its slot is final.": "اعتُمدت منطقة من درجات هذا الفريق: مكانه نهائي.",
  "That wave is now full. Choose another wave, or one of its stations to exchange places with the team on it.":
    "امتلأت هذه الموجة. اختر موجة أخرى، أو إحدى محطاتها لتبادل المكان مع الفريق الذي عليها.",
  "That wave has started since this page opened. Choose another wave.": "بدأت هذه الموجة بعد فتح الصفحة. اختر موجة أخرى.",
  "This part of the schedule changed a moment ago. The board was refreshed: check the slots and confirm again.":
    "تغيّر هذا الجزء من الجدول قبل لحظات. حُدّثت اللوحة: راجع الأماكن ثم أكّد مجددًا.",
  "That station was just taken. The board was refreshed: choose another.": "حُجزت هذه المحطة للتو. حُدّثت اللوحة: اختر غيرها.",
  "Choose a wave.": "اختر موجة.",
  "Choose a station": "اختر محطة",
  "Wave {wave} is full: choose one of its stations to exchange places with the team on it.": "الموجة {wave} ممتلئة: اختر إحدى محطاتها لتبادل المكان مع الفريق الذي عليها.",
  "This team has no station yet, so it cannot exchange places. Choose a free station.": "ليس لهذا الفريق محطة بعد، فلا يمكنه تبادل المكان. اختر محطة شاغرة.",
  "#{number} has a recorded score and cannot move. Choose another station.": "لـ#{number} درجة مسجّلة ولا يمكن نقله. اختر محطة أخرى.",
  "Tick the scheduling exception to confirm.": "ضع علامة على الاستثناء في الجدول للتأكيد.",
  "Tick the awards warning to confirm.": "ضع علامة على تنبيه التكريم للتأكيد.",
  "Tick the scheduling exception for #{number} to confirm.": "ضع علامة على الاستثناء في الجدول الخاص بـ#{number} للتأكيد.",
  "Tick the awards warning for #{number} to confirm.": "ضع علامة على تنبيه التكريم الخاص بـ#{number} للتأكيد.",
  "#{number} {name} and #{other} {otherName} exchanged places; both now run manually.": "تبادل #{number} {name} و#{other} {otherName} المكان؛ كلاهما يُدار يدويًا الآن.",
  "full — exchange only": "ممتلئة — تبادل فقط",
  "exchange with #{number} {name}": "تبادل مع #{number} {name}",
  "has a score": "لديه درجة",
  free: "شاغرة",
  "#{number} {name} takes this team's slot. Both teams will run manually: Auto Assign keeps each exactly where it is until it is returned to Auto Assign.":
    "يأخذ #{number} {name} مكان هذا الفريق. سيُدار الفريقان يدويًا: يُبقي التوزيع التلقائي كلًّا منهما في مكانه تمامًا حتى يُعاد إلى التوزيع التلقائي.",
  "Scheduling exception: #{number}, a {category} team, would run in the {block}.": "استثناء في الجدول: سيشارك #{number}، وهو فريق {category}، في {block}.",
  "#{number}'s new wave finishes at {finish}, after the {category} awards period begins ({from}–{to}).":
    "تنتهي الموجة الجديدة لـ#{number} عند {finish}، بعد بدء فترة تكريم {category} ({from}–{to}).",
  "This competition is finished: its running order can no longer change.": "انتهت هذه البطولة: لم يعد ترتيب موجاتها قابلًا للتغيير.",
  "This team's wave has started, so the team stays in it. To move it, reset that wave on Wave control first — possible only before any of its zones is submitted.":
    "بدأت موجة هذا الفريق، فيبقى فيها. لنقله أعد ضبط تلك الموجة من التحكم في الموجات أولًا — ممكن فقط قبل اعتماد أي من مناطقها.",
  "The team on that station has a recorded score, so it cannot move. Choose another station.": "للفريق الذي على هذه المحطة درجة مسجّلة، فلا يمكن نقله. اختر محطة أخرى.",
  "Confirm the scheduling exception for the team you exchange places with.": "أكّد الاستثناء في الجدول للفريق الذي تتبادل معه المكان.",
  "Confirm the awards warning for the team you exchange places with.": "أكّد تنبيه التكريم للفريق الذي تتبادل معه المكان.",

  // ── Settings → Category schedule › Auto Assign on/off ─────────────────────
  "Auto Assign": "التوزيع التلقائي",
  "On: Auto Assign builds the running order by these blocks, and changes that would break a block or move a team running manually are refused or need a confirmation.":
    "مُفعّل: يبني التوزيع التلقائي ترتيب الموجات حسب هذه الفترات، وأي تغيير يكسر فترة أو ينقل فريقًا يعمل يدويًا يُرفض أو يحتاج إلى تأكيد.",
  "Off: the running order is built by hand. Change any wave's time, category times and team slots freely — nothing is refused because of the category blocks, and nothing moves by itself.":
    "متوقف: يُبنى ترتيب الموجات يدويًا. غيّر موعد أي موجة ومواعيد الفئات وأماكن الفرق بحرية — لا يُرفض شيء بسبب فترات الفئات، ولا يتحرك شيء من تلقاء نفسه.",
  "Turn Auto Assign on? It can then rebuild the running order by these blocks; teams moved by hand keep their slot. Nobody moves until somebody presses Auto-assign waves.":
    "تفعيل التوزيع التلقائي؟ سيمكنه حينها إعادة بناء ترتيب الموجات حسب هذه الفترات، وتحتفظ الفرق المنقولة يدويًا بأماكنها. لن يتحرك أحد حتى يضغط أحدهم «توزيع تلقائي للموجات».",
  "Turn Auto Assign off? Waves, times and teams are then arranged by hand only, and the category blocks no longer hold up any change. Nobody moves now.":
    "إيقاف التوزيع التلقائي؟ ستُرتَّب الموجات والمواعيد والفرق يدويًا فقط، ولن تمنع فترات الفئات أي تغيير. لن يتحرك أحد الآن.",
  "Auto Assign is on.": "التوزيع التلقائي مُفعّل.",
  "Auto Assign is off. Change wave times and move teams on the Waves screen.": "التوزيع التلقائي متوقف. غيّر مواعيد الموجات وانقل الفرق من شاشة الموجات.",
  "Saved. Auto Assign is off, so no wave moved: set the wave times on the Waves screen.":
    "تم الحفظ. التوزيع التلقائي متوقف، فلم تتحرك أي موجة: اضبط مواعيد الموجات من شاشة الموجات.",
  "Auto Assign is off.": "التوزيع التلقائي متوقف.",
  "The running order is built by hand: change any wave's time, add waves and move teams freely — the category blocks hold nothing up. Nothing moves by itself.":
    "ترتيب الموجات يُبنى يدويًا: غيّر موعد أي موجة وأضف موجات وانقل الفرق بحرية — فترات الفئات لا تمنع شيئًا. لا يتحرك شيء من تلقاء نفسه.",
  "Auto Assign is switched off for this competition. Turn it on in Settings → Category schedule.":
    "التوزيع التلقائي متوقف لهذه المسابقة. فعّله من الإعدادات ← جدول الفئات.",
};
