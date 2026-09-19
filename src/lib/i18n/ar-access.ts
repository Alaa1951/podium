import type { Phrases } from "@/lib/i18n/phrases";

/** The role system: roles, a person's access, account types, homes. */
export const AR_ACCESS: Phrases = {
  // ── Account types ──────────────────────────────────────────────────────────
  "BFT MENA · Full access": "بي إف تي مينا · صلاحية كاملة",
  "BFT MENA · Partial access": "بي إف تي مينا · صلاحية جزئية",
  "BFT MENA Partial": "بي إف تي مينا - صلاحية جزئية",
  "Gym / Studio": "الجيم / الاستوديو",
  Organiser: "منظم",
  Organisers: "المنظمون",
  Athlete: "رياضي",
  "Account type": "نوع الحساب",
  Home: "الرئيسية",
  Scores: "الدرجات",
  View: "عرض",

  // ── Roles screen ───────────────────────────────────────────────────────────
  "Each role is a set of screens and actions. Tick what a role may open and do, then give it to people from their Access panel. A person can hold several roles, and their access adds up.":
    "كل دور هو مجموعة من الشاشات والإجراءات. حدد ما يمكن للدور فتحه وفعله، ثم امنحه للأشخاص من لوحة الصلاحيات الخاصة بهم. يمكن للشخص أن يحمل أكثر من دور، وتُجمع صلاحياته.",
  "Role created.": "تم إنشاء الدور.",
  "Role saved.": "تم حفظ الدور.",
  "Role deleted.": "تم حذف الدور.",
  "Delete the role {name}?": "حذف الدور {name}؟",
  "Head judge": "رئيس الحكام",
  "Ships with Podium": "مدمج مع Podium",
  "Studios can give this": "يمكن للاستوديوهات منحه",
  "What this role is for": "الغرض من هذا الدور",
  "Who can give this role": "من يمكنه منح هذا الدور",
  "BFT MENA and studios": "بي إف تي مينا والاستوديوهات",
  "Meant for": "مخصص لـ",
  "Always on for everyone": "مفعّل دائمًا للجميع",
  "Always on": "مفعّل دائمًا",
  "BFT MENA Full access only": "للصلاحية الكاملة في بي إف تي مينا فقط",
  "Not in a role studios can give": "غير مسموح في دور تمنحه الاستوديوهات",
  "You don't hold this": "لا تملك هذه الصلاحية",
  "Not for this account type": "غير متاح لهذا النوع من الحسابات",
  "Roles Podium ships with cannot be deleted. Edit them instead.":
    "لا يمكن حذف الأدوار المدمجة مع Podium. يمكنك تعديلها بدلًا من ذلك.",
  "People still hold this role. Take it away from them first.":
    "ما زال هناك أشخاص يحملون هذا الدور. اسحبه منهم أولًا.",
  "Someone else changed this role while you were editing. Reload to see their changes.":
    "قام شخص آخر بتعديل هذا الدور أثناء تعديلك. أعد تحميل الصفحة لرؤية تعديلاته.",
  "You can only give permissions you hold yourself.": "يمكنك منح الصلاحيات التي تملكها أنت فقط.",
  "A role studios can give cannot carry BFT MENA-only permissions.":
    "الدور الذي تمنحه الاستوديوهات لا يمكن أن يحتوي على صلاحيات خاصة ببي إف تي مينا.",
  "That permission cannot be put in a role.": "لا يمكن وضع هذه الصلاحية في دور.",

  // ── A person's access ──────────────────────────────────────────────────────
  "What this person can do": "ما يمكن لهذا الشخص فعله",
  "{n} of {total} permissions": "{n} من {total} صلاحية",
  "From role: {roles}": "من الدور: {roles}",
  "Granted to this person": "ممنوحة لهذا الشخص",
  "Locked for this person": "مقفلة لهذا الشخص",
  "Given, but not for this account type": "ممنوحة، لكنها غير متاحة لهذا النوع من الحسابات",
  Allowed: "مسموح",
  "Not allowed": "غير مسموح",
  "Access for this permission": "الصلاحية لهذا الإجراء",
  Inherit: "من الدور",
  Grant: "منح",
  Lock: "قفل",
  "Inherit all": "الكل من الدور",
  "Lock all": "قفل الكل",
  "Save access": "حفظ الصلاحيات",
  "Give a role": "منح دور",
  "Choose a role…": "اختر دورًا…",
  "Give role": "منح الدور",
  "Role given.": "تم منح الدور.",
  "Role taken away.": "تم سحب الدور.",
  "Take the role {name} away?": "سحب الدور {name}؟",
  "Applies while no role is given": "يُطبق ما دام لم يُمنح أي دور",
  "Default: {name}": "افتراضي: {name}",
  Default: "افتراضي",
  Everything: "كل شيء",
  "BFT MENA Full access passes every check. Roles and locks do not apply.":
    "الصلاحية الكاملة في بي إف تي مينا تتجاوز كل التحققات. لا تنطبق عليها الأدوار ولا الأقفال.",
  "Inherit follows their roles. Grant adds one permission for this person only. Lock takes it away, and always wins.":
    "«من الدور» يتبع أدواره. «منح» يضيف صلاحية لهذا الشخص وحده. «قفل» يسحبها، ويتقدم دائمًا على غيره.",
  "Worked out from their roles. Only BFT MENA can grant or lock single permissions.":
    "محسوبة من أدواره. بي إف تي مينا وحدها تستطيع منح أو قفل صلاحيات فردية.",
  "Someone else changed this person's access while you were editing. Reload to see it.":
    "قام شخص آخر بتعديل صلاحيات هذا الشخص أثناء تعديلك. أعد تحميل الصفحة لرؤيتها.",
  "Studios can't give this role.": "لا يمكن للاستوديوهات منح هذا الدور.",
  "You cannot change your own access — ask someone else.": "لا يمكنك تعديل صلاحياتك بنفسك — اطلب ذلك من شخص آخر.",
  "That permission can't be granted to anyone.": "لا يمكن منح هذه الصلاحية لأي شخص.",
  "That person or role no longer exists.": "هذا الشخص أو الدور لم يعد موجودًا.",

  // ── Users and people ───────────────────────────────────────────────────────
  "Everyone who can sign in, with the roles they hold. Open a person to see exactly what they can do, and to give or take away roles.":
    "كل من يمكنه تسجيل الدخول مع أدواره. افتح أي شخص لترى بالضبط ما يمكنه فعله، ولتمنحه أدوارًا أو تسحبها.",
  "Remove {name} from the platform?": "إزالة {name} من المنصة؟",
  "People you add here belong to {studio}.": "الأشخاص الذين تضيفهم هنا يتبعون {studio}.",
  "No studio": "بدون استوديو",
  "The account is created with no password. They receive a link by email and choose one themselves. Give them roles from their Access panel once it exists.":
    "يُنشأ الحساب بدون كلمة مرور. يصلهم رابط بالبريد ويختارون كلمة المرور بأنفسهم. امنحهم الأدوار من لوحة الصلاحيات بعد إنشاء الحساب.",
  "Everyone in {studio}. Open a person to give them the Athlete, Organiser or Judge role, or to take one away.":
    "كل الأشخاص في {studio}. افتح أي شخص لتمنحه دور رياضي أو منظم أو حكم، أو لتسحبه.",
  "your studio": "الاستوديو الخاص بك",

  // ── Home ───────────────────────────────────────────────────────────────────
  "Welcome, {name}": "أهلًا، {name}",
  "Everything your roles let you open, in one place.": "كل ما تسمح لك أدوارك بفتحه، في مكان واحد.",
  "You are on the floor as a judge.": "أنت على أرض البطولة كحكم.",
  "Open my score sheet": "افتح ورقة الدرجات الخاصة بي",

  // ── Competition and studio screens ─────────────────────────────────────────
  "Only BFT MENA manages sponsors.": "بي إف تي مينا وحدها تدير الرعاة.",
  "Assign teams to their waves from the Waves screen; put judges on the floor from Score entry.":
    "وزّع الفرق على موجاتها من شاشة الموجات، وضع الحكام على الأرض من شاشة إدخال الدرجات.",
  "Scores are entered by the judges on the floor. Ask BFT MENA for any correction.":
    "يُدخل الحكام الدرجات على أرض البطولة. اطلب أي تصحيح من بي إف تي مينا.",
  "Scores are entered by the judges on the floor. Yours appear here as they are recorded.":
    "يُدخل الحكام الدرجات على أرض البطولة. تظهر درجاتك هنا فور تسجيلها.",
  "Studios register and pair their own athletes, place their teams in waves, and follow their own results. Scores are entered by the judges on the floor.":
    "تسجل الاستوديوهات رياضييها وتجمعهم في فرق، وتوزع فرقها على الموجات، وتتابع نتائجها. ويُدخل الحكام الدرجات على أرض البطولة.",
  "Team changes": "تعديلات الفرق",
};
