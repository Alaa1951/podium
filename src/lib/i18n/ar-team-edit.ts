import type { Phrases } from "@/lib/i18n/phrases";

/**
 * BFT MENA Full access correcting a team on its registration form: any
 * athlete's name and email, a signed-in athlete's sign-in email with it
 * (staff-membership.ts › correctEmail).
 */
export const AR_TEAM_EDIT: Phrases = {
  "Correcting a name or an email keeps the same athlete — their account, waiver and check-in stay. To put someone else in the team, use Swap on the athlete's page.":
    "تصحيح الاسم أو البريد الإلكتروني يُبقي الرياضي نفسه — يبقى حسابه وإقراره وتسجيل حضوره. لوضع شخص آخر في الفريق، استخدم «استبدال» في صفحة الرياضي.",
  "Has a PODIUM account: a corrected email becomes the one they sign in with.":
    "لديه حساب في PODIUM: البريد المصحَّح يصبح البريد الذي يسجّل الدخول به.",
  "Same athlete: I confirm their sign-in email changes to the new one. Codes and links sent to the old email stop working.":
    "الرياضي نفسه: أؤكد تغيير بريد تسجيل الدخول الخاص به إلى البريد الجديد. تتوقف الرموز والروابط المرسلة إلى البريد القديم عن العمل.",
  "Tick the box to confirm the athlete's sign-in email changes.":
    "ضع علامة في المربع لتأكيد تغيير بريد تسجيل دخول الرياضي.",
  "Another PODIUM account already uses that email. To put that account in the team, use Swap on the athlete's page.":
    "هذا البريد مستخدم بالفعل لحساب آخر في PODIUM. لوضع ذلك الحساب في الفريق، استخدم «استبدال» في صفحة الرياضي.",
  "You cannot change your own sign-in email here. Another Full access account can.":
    "لا يمكنك تغيير بريد تسجيل الدخول الخاص بك من هنا. يمكن لحساب آخر بصلاحية كاملة القيام بذلك.",

  // The Athletes section of a team's page: an Edit button beside each athlete.
  "Team changes closed on {when} (Qatar time). A change the athlete asks for can still be made here, on their request.":
    "أُغلقت تعديلات الفرق في {when} (بتوقيت قطر). لا يزال من الممكن إجراء تعديل يطلبه الرياضي من هنا، بناءً على طلبه.",
  "Has a PODIUM account": "لديه حساب في PODIUM",
  "Correct details": "تصحيح البيانات",
  "Replace with another person": "استبدال بشخص آخر",
  "The same athlete: their check-in, warm-up and waiver stay.": "الرياضي نفسه: يبقى تسجيل حضوره وإحماؤه وإقراره كما هي.",
  "Team changes are closed. Tick that the athlete asked for this change.":
    "تعديلات الفرق مغلقة. ضع علامة تفيد بأن الرياضي طلب هذا التعديل.",
  "This athlete signs in to PODIUM: their name, email and phone are their account's. They change them in their profile, or BFT MENA Full access does.":
    "هذا الرياضي يسجّل الدخول إلى PODIUM: اسمه وبريده وهاتفه تخص حسابه. يغيّرها هو من ملفه الشخصي، أو تغيّرها BFT MENA بالصلاحية الكاملة.",
};
