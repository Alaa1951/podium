import type { Phrases } from "@/lib/i18n/phrases";

/**
 * Waiver Declarations, the check-in and check-out desks, Start Wave's
 * readiness list, and the live board's "Up next". The waiver documents
 * themselves are never translated here: each language edition is BFT MENA's
 * own text (src/lib/waivers/documents).
 */
export const AR_WAIVERS: Phrases = {
  // ── The athlete's page ─────────────────────────────────────────────────────
  "Waiver Declarations": "الإقرارات والموافقات",
  Waiver: "الإقرار",
  "Waiver version": "إصدار الإقرار",
  "Your team": "فريقك",
  Signed: "موقَّع",
  "Pending signature": "بانتظار التوقيع",
  "Requires re-signing": "يتطلب إعادة التوقيع",
  "Not required": "غير مطلوب",
  "None of your competitions asks for a waiver right now.": "لا تطلب أي من مسابقاتك إقرارًا حاليًا.",
  "You signed version {version} on {date} ({language}).": "وقّعت الإصدار {version} في {date} ({language}).",
  "You signed an earlier version. Read the current version below and sign it — your earlier signature is kept.":
    "وقّعت إصدارًا سابقًا. اقرأ الإصدار الحالي أدناه ووقّعه — ويبقى توقيعك السابق محفوظًا.",
  "Every athlete signs for themselves. Read the whole waiver below, then sign it under the document.":
    "يوقّع كل رياضي عن نفسه. اقرأ الإقرار كاملًا أدناه، ثم وقّعه أسفل المستند.",
  "Your signed waivers": "إقراراتك الموقَّعة",
  "Version {version}": "الإصدار {version}",
  "Earlier version": "إصدار سابق",
  "View receipt": "عرض الإيصال",
  "Signed. Your waiver is saved.": "تم التوقيع. حُفظ إقرارك.",
  "Tick the box to confirm you have read and agree to the waiver.": "ضع علامة في المربع لتأكيد أنك قرأت الإقرار وتوافق عليه.",
  "Type your full name to sign.": "اكتب اسمك بالكامل للتوقيع.",
  "That name is too long.": "هذا الاسم طويل جدًا.",
  "A newer version of this waiver was published. Review the current version, then sign it.": "نُشر إصدار أحدث من هذا الإقرار. راجع الإصدار الحالي، ثم وقّعه.",
  "You are not registered in this competition.": "لست مسجّلًا في هذه المسابقة.",
  "You hold more than one place in this competition. Ask BFT MENA to correct it before signing.": "لديك أكثر من مكان في هذه المسابقة. اطلب من BFT MENA تصحيح ذلك قبل التوقيع.",
  "This competition no longer asks for a waiver.": "لم تعد هذه المسابقة تطلب إقرارًا.",
  "Only the athlete can sign their own waiver.": "لا يوقّع الإقرار إلا الرياضي نفسه.",

  // ── The prompt and My team ─────────────────────────────────────────────────
  "Waiver acceptance required for {competition}.": "مطلوب قبول الإقرار لـ{competition}.",
  "Your waiver for {competition} needs signing again.": "إقرارك لـ{competition} يحتاج إلى توقيع جديد.",
  "{count} waivers need your signature.": "{count} إقرارات تحتاج إلى توقيعك.",
  "Read and sign": "اقرأ ووقّع",
  "Waiver signed": "الإقرار موقَّع",
  "A new version of the waiver needs your signature before you can check in.": "يحتاج الإصدار الجديد من الإقرار إلى توقيعك قبل أن تتمكن من تسجيل الحضور.",
  "Sign your waiver before you can check in at the entrance. Your partner signs their own.": "وقّع إقرارك قبل تسجيل الحضور عند الدخول. ويوقّع شريكك إقراره بنفسه.",

  // ── The receipt ────────────────────────────────────────────────────────────
  "Waiver receipt": "إيصال الإقرار",
  "Waiver acceptance receipt": "إيصال قبول الإقرار",
  Print: "طباعة",
  "Category and level when signed": "الفئة والمستوى عند التوقيع",
  "Language signed": "لغة التوقيع",
  Signature: "التوقيع",
  "Signature method": "طريقة التوقيع",
  "Full name typed by the athlete, with “Agree & Sign” (electronic signature)": "الاسم بالكامل مكتوبًا بيد الرياضي مع «أوافق وأوقّع» (توقيع إلكتروني)",
  "Accepted at": "وقت القبول",
  "Qatar time": "بتوقيت قطر",
  "Acknowledgement accepted": "الإقرار المقبول",
  "Document fingerprint (SHA-256)": "بصمة المستند (SHA-256)",
  "Matches the signed document": "مطابقة للمستند الموقَّع",
  "Does not match — report this to BFT MENA": "غير مطابقة — أبلغ BFT MENA بذلك",
  "The document as signed": "المستند كما وُقِّع",

  // ── Settings → Waiver ──────────────────────────────────────────────────────
  "Every athlete signs the competition's waiver themselves, in English or Arabic, before the entrance lets them in. Nobody can sign for them. Only a document attached here applies to this competition.":
    "يوقّع كل رياضي إقرار المسابقة بنفسه، بالعربية أو الإنجليزية، قبل السماح له بالدخول. لا يمكن لأحد التوقيع عنه. ولا يسري على هذه المسابقة إلا المستند المرفق هنا.",
  "Version {version} is required": "الإصدار {version} مطلوب",
  "since {date}": "منذ {date}",
  "{signed} of {total} athletes in the field have signed": "وقّع {signed} من {total} رياضيًا في المنافسة",
  "No waiver is required for this competition.": "لا يُطلب إقرار لهذه المسابقة.",
  "document version {version}": "إصدار المستند {version}",
  "Written for {date}; this competition is on {day}. Attach it only if it is the right event.": "كُتب ليوم {date}؛ وهذه المسابقة في {day}. أرفقه فقط إن كان للفعالية الصحيحة.",
  "Required now": "مطلوب الآن",
  "Require this version instead": "اطلب هذا الإصدار بدلًا منه",
  "Require this waiver": "اطلب هذا الإقرار",
  "Require this version? Signatures of the current version are kept, and every athlete must sign the new one before entry.":
    "طلب هذا الإصدار؟ تبقى توقيعات الإصدار الحالي محفوظة، ويجب على كل رياضي توقيع الإصدار الجديد قبل الدخول.",
  "Require this waiver for this competition? From now on, every athlete must sign it before entry.": "طلب هذا الإقرار لهذه المسابقة؟ من الآن يجب على كل رياضي توقيعه قبل الدخول.",
  "Earlier versions": "الإصدارات السابقة",
  "version {version} ({count} signatures kept)": "الإصدار {version} ({count} توقيعًا محفوظًا)",
  "Signed records ({count})": "السجلات الموقَّعة ({count})",
  Version: "الإصدار",
  "Signed at": "وقت التوقيع",
  Receipt: "الإيصال",
  "This version is already the one athletes sign.": "هذا الإصدار هو ما يوقّعه الرياضيون بالفعل.",
  "That document is not available.": "هذا المستند غير متاح.",

  // ── The desks ──────────────────────────────────────────────────────────────
  "Check out": "تسجيل المغادرة",
  "Check out whole team": "تسجيل مغادرة الفريق كله",
  "Not checked in — nobody on this team was checked in.": "لم يُسجَّل الحضور — لم يُسجَّل حضور أي فرد من هذا الفريق.",
  "Check again": "تحقّق مجددًا",
  "Warm-up check-out": "إلغاء الجاهزية في الإحماء",
  "Not checked in at warm-up.": "لم تُسجَّل الجاهزية في الإحماء.",
  "Any waiver status": "أي حالة للإقرار",
  "Everybody signed": "وقّع الجميع",
  "Waiver acceptance required": "مطلوب قبول الإقرار",
  "Waiver: re-sign required": "الإقرار: مطلوب إعادة التوقيع",
  "No account — cannot sign yet": "لا يوجد حساب — لا يمكن التوقيع بعد",
  "No PODIUM account yet — the athlete signs in with their registration email, then signs the waiver": "لا يوجد حساب PODIUM بعد — يسجّل الرياضي الدخول ببريد التسجيل ثم يوقّع الإقرار",
  "Waiver acceptance required — the athlete signs on their own Waiver Declarations page": "مطلوب قبول الإقرار — يوقّع الرياضي من صفحة «الإقرارات والموافقات» الخاصة به",
  "Waiver must be signed again — the athlete signs the current version on their own page": "يجب توقيع الإقرار مجددًا — يوقّع الرياضي الإصدار الحالي من صفحته",
  "Not checked in at the entrance": "لم يُسجَّل حضوره عند الدخول",
  "Not holding a place (withdrawn or on the waiting list)": "لا يشغل مكانًا (منسحب أو في قائمة الانتظار)",
  "No athletes on the team": "لا يوجد رياضيون في الفريق",
  "Not placed in a wave": "غير موزّع على موجة",
  "Not checked in at warm-up for this wave": "لم تُسجَّل جاهزيته في الإحماء لهذه الموجة",

  // ── Privacy review (cross-category slots) ──────────────────────────────────
  "Privacy review: the women's competition is never photographed or recorded (waiver §8), while the men's and mixed portions may be filmed (§9). This slot changes no category and gives no media consent — BFT MENA checks it before the wave.":
    "مراجعة الخصوصية: منافسات السيدات لا تُصوَّر ولا تُسجَّل مطلقًا (الإقرار §8)، بينما قد تُصوَّر منافسات الرجال والمختلطة (§9). هذا المكان لا يغيّر أي فئة ولا يمنح أي موافقة إعلامية — تراجعه BFT MENA قبل الموجة.",
  "Privacy review before the wave": "مراجعة الخصوصية قبل الموجة",

  // ── Wave control ───────────────────────────────────────────────────────────
  "Wave {wave} cannot start yet. Every athlete must be registered, signed, checked in, and ready in warm-up for this wave.":
    "لا يمكن بدء الموجة {wave} بعد. يجب أن يكون كل رياضي مسجّلًا وموقّعًا ومسجّل الحضور وجاهزًا في الإحماء لهذه الموجة.",
  "A waiver is signed by the athlete alone, on their own phone: PODIUM → Waiver Declarations. Staff cannot sign for them.":
    "يوقّع الرياضي الإقرار بنفسه من هاتفه: PODIUM ← الإقرارات والموافقات. لا يمكن للطاقم التوقيع عنه.",

  // ── The live board ─────────────────────────────────────────────────────────
  "{count} teams in this wave": "{count} فرق في هذه الموجة",
  "No upcoming waves": "لا توجد موجات قادمة",
  "No upcoming waves.": "لا توجد موجات قادمة.",
};
