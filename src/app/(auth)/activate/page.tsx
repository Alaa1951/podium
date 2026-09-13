import { AuthShell } from "@/components/auth/auth-shell";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { consumeAuthToken } from "@/lib/auth-tokens";
import { getTranslator } from "@/lib/i18n/server";

/**
 * Where an invitation link lands. The token is checked here so an expired link
 * says so straight away rather than after a password is typed — but it is only
 * spent by the POST that actually sets the password.
 */
export default async function ActivatePage(props: PageProps<"/activate">) {
  const params = await props.searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const { t } = await getTranslator();

  const record = token ? await consumeAuthToken({ token, purpose: "invite" }) : null;

  if (!record) {
    return (
      <AuthShell title={t("Set your password")}>
        <p style={{ color: "var(--danger-bright)", fontSize: 14, textAlign: "center" }}>
          {t("That link is invalid or has expired.")}
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("Set your password")} blurb={record.user.email}>
      <SetPasswordForm token={token} purpose="invite" />
    </AuthShell>
  );
}
