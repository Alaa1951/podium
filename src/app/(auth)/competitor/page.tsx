import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { CompetitorLoginForm } from "@/components/auth/competitor-login-form";
import { getTranslator } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The competitor's door. Separate from the staff sign-in because it works
 * differently: no password, a code by email, and a day-long session.
 */
export default async function CompetitorLoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "competitor" ? "/me" : "/");

  const { t } = await getTranslator();

  return (
    <AuthShell
      title={t("Competitor sign-in")}
      blurb={t(
        "Registered for PODIUM? Sign in with the email you entered with — no password needed."
      )}
    >
      <CompetitorLoginForm />
    </AuthShell>
  );
}
