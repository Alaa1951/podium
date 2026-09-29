import { AuthShell } from "@/components/auth/auth-shell";
import { RefusedCodeNotice } from "@/components/auth/refused-code-notice";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { peekAuthLink } from "@/lib/auth-tokens";
import { getTranslator } from "@/lib/i18n/server";

export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const params = await props.searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const { t } = await getTranslator();

  const record = token ? await peekAuthLink({ token, purpose: "reset" }) : null;

  if (!record) {
    return (
      <AuthShell title={t("Choose a new password")}>
        {/* Used, expired, sent to an address the account no longer has, or
            older than recipient records: whichever it was, a new one to the
            current address is one tap away (both answer the same way). */}
        <RefusedCodeNotice kind="link" />
      </AuthShell>
    );
  }

  return (
    <AuthShell title={record.user.passwordHash ? t("Choose a new password") : t("Create a password")} blurb={record.user.email}>
      <SetPasswordForm token={token} purpose="reset" />
    </AuthShell>
  );
}
