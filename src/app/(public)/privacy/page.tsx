import type { Metadata } from "next";

import { PublicShell } from "@/components/public/public-shell";
import { getTranslator } from "@/lib/i18n/server";

import "./privacy.css";

export const metadata: Metadata = {
  title: "Privacy Policy — PODIUM",
};

/**
 * THE PRIVACY POLICY — the page both app stores ask for.
 *
 * Long-form legal text, not UI chrome, so it renders as two hand-written
 * documents (English / Arabic) picked by the session locale instead of going
 * through the translation dictionary. The claims here mirror what the system
 * actually does: organizer-issued accounts, emailed OTP codes, hashed device
 * fingerprints, public published results, and zero third-party services.
 */
export default async function PrivacyPage() {
  const { locale } = await getTranslator();
  const ar = locale === "ar";

  return (
    <PublicShell back={{ href: "/results", label: ar ? "النتائج" : "Results" }}>
      <article className="privacy" dir={ar ? "rtl" : "ltr"}>
        {ar ? <Arabic /> : <English />}
      </article>
    </PublicShell>
  );
}

function English() {
  return (
    <>
      <p className="privacy-eyebrow">PODIUM · BFT MENA</p>
      <h1 className="pb-title">Privacy Policy</h1>
      <p className="privacy-updated">Last updated: 16 September 2026</p>

      <section>
        <h2>The short version</h2>
        <p>
          PODIUM is the competition platform of BFT MENA. We collect only what
          running the competition needs: account emails and names, scores and
          results, and the minimum security data required to protect sign-ins.
          No advertising, no trackers, no analytics, no data selling — the
          website and the mobile apps run entirely on our own infrastructure
          and talk to no third-party service.
        </p>
      </section>

      <section>
        <h2>Who runs this service</h2>
        <p>
          The PODIUM platform (this website and its mobile applications) is
          operated by BFT MENA. For any privacy question or request, contact us
          at <a href="mailto:admin@bftmena.com">admin@bftmena.com</a>.
        </p>
      </section>

      <section>
        <h2>Accounts and sign-in</h2>
        <p>
          Accounts are created and invited by the organizing team — there is
          no open registration. For each account we store the email address,
          an optional display name, the role (staff or competitor), and the
          language preference.
        </p>
        <p>
          There are two ways to sign in, and both are internal to PODIUM:
        </p>
        <ul>
          <li>
            Credentials issued by the organizer. Passwords are stored only as
            salted hashes — never in plain text.
          </li>
          <li>
            A one-time code (OTP) sent by email to the account&rsquo;s own
            address. Codes are stored hashed, expire within minutes, and each
            code works once.
          </li>
        </ul>
        <p>
          We offer no social logins — no Sign in with Apple, Google, or any
          other provider — so nothing about you is ever shared with a login
          provider, because none is used.
        </p>
      </section>

      <section>
        <h2>Sign-in security data</h2>
        <p>
          For every sign-in attempt we keep the time, the IP address, and a
          one-way hash (HMAC-SHA256) of device characteristics. Recognized
          devices are listed on a &ldquo;trusted devices&rdquo; screen with
          their browser, operating system and device type, and can be revoked
          by the account owner at any time. These records exist solely to
          protect accounts from unauthorized access. They are never used for
          profiling, advertising, or marketing.
        </p>
      </section>

      <section>
        <h2>Competition data, and what is public</h2>
        <p>
          The service records the competition itself: studios, series, waves,
          teams, competitor names, scores and results. Published results are
          public by design — that is the product. The public results board
          (and the mobile applications) show team and competitor names,
          ranks and scores for competitions that the organizer has finished
          and published.
        </p>
      </section>

      <section>
        <h2>What we never do</h2>
        <ul>
          <li>We show no advertising and sell nothing.</li>
          <li>
            We run no analytics, tracking scripts, or third-party CDNs. The
            site is fully self-contained.
          </li>
          <li>
            We do not sell, rent, or share personal data with any third
            party.
          </li>
          <li>
            Emails are operational only: invitations, password resets, and
            sign-in codes.
          </li>
        </ul>
      </section>

      <section>
        <h2>Retention and deletion</h2>
        <p>
          Account data is kept while the account is active. Competition
          records belong to the organizer and the competitor&rsquo;s studio.
          To access, correct, or delete your personal data, contact the
          organizing team or write to us at the address above, and we will
          action the request.
        </p>
      </section>

      <section>
        <h2>Security</h2>
        <p>
          Traffic is encrypted in transit (TLS). Passwords and one-time codes
          are stored only as hashes. Sign-in attempts and staff actions are
          logged and auditable. Access to production systems is limited to
          the platform operators.
        </p>
      </section>

      <section>
        <h2>Changes to this policy</h2>
        <p>
          If we change this policy, the updated version will be published on
          this page with a new date. Material changes will also be announced
          inside the app.
        </p>
      </section>
    </>
  );
}

function Arabic() {
  return (
    <>
      <p className="privacy-eyebrow">بوديوم · BFT MENA</p>
      <h1 className="pb-title">سياسة الخصوصية</h1>
      <p className="privacy-updated">آخر تحديث: ١٦ سبتمبر ٢٠٢٦</p>

      <section>
        <h2>الخلاصة أولًا</h2>
        <p>
          بوديوم هو منصة بطولات BFT MENA. نجمع فقط ما تحتاجه إدارة البطولة:
          البريد الإلكتروني والاسم لحسابات المنظّمين، والنتائج والدرجات،
          والحد الأدنى من بيانات الأمان اللازمة لحماية تسجيل الدخول. لا
          إعلانات، ولا متتبعات، ولا أدوات تحليلات، ولا بيع للبيانات — الموقع
          وتطبيقات الجوال تعمل بالكامل على بنيتنا التحتية الخاصة ولا تتصل بأي
          خدمة خارجية.
        </p>
      </section>

      <section>
        <h2>مَن يدير هذه الخدمة</h2>
        <p>
          منصة بوديوم (هذا الموقع وتطبيقات الجوال الخاصة به) يديرها BFT MENA.
          لأي سؤال أو طلب متعلق بالخصوصية، تواصل معنا على{" "}
          <a href="mailto:admin@bftmena.com">admin@bftmena.com</a>.
        </p>
      </section>

      <section>
        <h2>الحسابات وتسجيل الدخول</h2>
        <p>
          تُنشأ الحسابات عن طريق فريق التنظيم بالدعوة — لا يوجد تسجيل مفتوح
          للعامة. لكل حساب نخزّن البريد الإلكتروني، والاسم المعروض (اختياري)،
          والدور (طاقم تنظيمي أو متسابق)، ولغة الواجهة المفضلة.
        </p>
        <p>هناك طريقتان لتسجيل الدخول، وكلتاهما داخلية بالكامل:</p>
        <ul>
          <li>
            بيانات دخول يصدرها المنظّم. كلمات المرور تُخزَّن بصيغة مشفّرة
            أحادية الاتجاه (hash) فقط — أبدًا كنص صريح.
          </li>
          <li>
            رمز استخدام واحد (OTP) يُرسل بالبريد الإلكتروني إلى عنوان الحساب
            نفسه. تُخزَّن الرموز مشفّرة، وتنتهي صلاحيتها خلال دقائق، وكل رمز
            يعمل مرة واحدة فقط.
          </li>
        </ul>
        <p>
          لا نوفّر أي تسجيل دخول عبر الشبكات الاجتماعية — لا «Sign in with
          Apple» ولا Google ولا غيرهما — لذلك لا تُشارَك أي معلومات عنك مع أي
          مزوّد دخول، لأننا لا نستخدم أيًّا منهم أصلًا.
        </p>
      </section>

      <section>
        <h2>بيانات أمان تسجيل الدخول</h2>
        <p>
          مع كل محاولة دخول نحفظ الوقت وعنوان IP وبصمة تشفيرية أحادية الاتجاه
          (HMAC-SHA256) لخصائص الجهاز. الأجهزة الموثوقة تظهر في شاشة «الأجهزة
          الموثوقة» مع نوع المتصفح ونظام التشغيل والجهاز، ويمكن لصاحب الحساب
          إلغاء توثيقها في أي وقت. هذه السجلات موجودة لحماية الحسابات من
          الوصول غير المصرّح به فقط، ولا تُستخدم أبدًا للتنميط أو الإعلان أو
          التسويق.
        </p>
      </section>

      <section>
        <h2>بيانات البطولات، وما هو عام</h2>
        <p>
          تسجّل الخدمة البطولة نفسها: الصالات، والسلاسل، والموجات، والفرق،
          وأسماء المتسابقين، والدرجات والنتائج. النتائج المنشورة عامة بطبيعتها
          — فهذا هو المنتج نفسه: لوحة النتائج العامة (وتطبيقات الجوال) تعرض
          أسماء الفرق والمتسابقين والمراكز والدرجات للبطولات التي أنهىها
          المنظّم ونشرها.
        </p>
      </section>

      <section>
        <h2>ما لا نفعله أبدًا</h2>
        <ul>
          <li>لا نعرض إعلانات ولا نبيع شيئًا.</li>
          <li>
            لا نستخدم أدوات تحليلات أو سكربتات تتبع أو شبك توصيل محتوى خارجي
            — الموقع مكتفٍ بذاته بالكامل.
          </li>
          <li>لا نبيع ولا نؤجّر ولا نشارك البيانات الشخصية مع أي طرف ثالث.</li>
          <li>
            الرسائل البريدية تشغيلية فقط: دعوات، واستعادة كلمات مرور، ورموز
            تسجيل دخول.
          </li>
        </ul>
      </section>

      <section>
        <h2>الاحتفاظ بالبيانات وحذفها</h2>
        <p>
          تُحفظ بيانات الحساب ما دام الحساب نشطًا. سجلات البطولات ملك للمنظّم
          والصالة التي ينتمي إليها المتسابق. للوصول إلى بياناتك أو تصحيحها أو
          حذفها، تواصل مع فريق التنظيم أو راسلنا على العنوان أعلاه وسنستجيب
          للطلب.
        </p>
      </section>

      <section>
        <h2>الأمان</h2>
        <p>
          الاتصال مشفّر أثناء النقل (TLS). كلمات المرور ورموز الدخول تُخزَّن
          بصيغة مشفّرة أحادية فقط. محاولات الدخول وإجراءات الطاقم مسجّلة
          وقابلة للتدقيق. الوصول إلى أنظمة التشغيل محصور بمشغّلي المنصة.
        </p>
      </section>

      <section>
        <h2>التغييرات على هذه السياسة</h2>
        <p>
          إذا غيّرنا هذه السياسة، سننشر النسخة المحدّثة على هذه الصفحة بتاريخ
          جديد، وستُعلن التغييرات الجوهرية أيضًا داخل التطبيق.
        </p>
      </section>
    </>
  );
}
