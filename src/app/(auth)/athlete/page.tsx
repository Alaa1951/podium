import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { CompetitorLoginForm } from "@/components/auth/competitor-login-form";
import { getTranslator } from "@/lib/i18n/server";
import { getCurrentUser, homeForUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The athlete's door. Separate from the staff sign-in because it works
 * differently: no password, a code by email. A code goes out for a paid
 * registration or an athlete account — and the screen says the same either way.
 */
export default async function AthleteLoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(await homeForUser(user));

  const { t } = await getTranslator();

  return (
    <AuthShell
      title={t("Athlete sign-in")}
      blurb={t("Registered for PODIUM? Sign in with the email you entered with — we send you a code.")}
      footer={
        <p className="auth-note" style={{ textAlign: "center" }}>
          {t("New here?")}{" "}
          <Link href="/signup?type=athlete" style={{ color: "var(--bft-cyan)" }}>
            {t("Sign up")}
          </Link>
        </p>
      }
    >
      <CompetitorLoginForm />
    </AuthShell>
  );
}
