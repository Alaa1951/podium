import { AuthShell } from "@/components/auth/auth-shell";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { consumeAuthToken } from "@/lib/auth-tokens";
import { getTranslator } from "@/lib/i18n/server";

export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const params = await props.searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const { t } = await getTranslator();

  const record = token ? await consumeAuthToken({ token, purpose: "reset" }) : null;

  if (!record) {
    return (
      <AuthShell title={t("Choose a new password")}>
        <p style={{ color: "var(--danger-bright)", fontSize: 14, textAlign: "center" }}>
          {t("That link is invalid or has expired.")}
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("Choose a new password")} blurb={record.user.email}>
      <SetPasswordForm token={token} purpose="reset" />
    </AuthShell>
  );
}
