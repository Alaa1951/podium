import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { getTranslator } from "@/lib/i18n/server";

export default async function ForgotPasswordPage() {
  const { t } = await getTranslator();

  return (
    <AuthShell title={t("Reset your password")}>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
