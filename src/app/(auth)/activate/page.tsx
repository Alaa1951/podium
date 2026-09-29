import { AuthShell } from "@/components/auth/auth-shell";
import { RefusedCodeNotice } from "@/components/auth/refused-code-notice";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { peekAuthLink } from "@/lib/auth-tokens";
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

  const record = token ? await peekAuthLink({ token, purpose: "invite" }) : null;

  if (!record) {
    return (
      <AuthShell title={t("Set your password")}>
        {/* Used, expired, sent to an address the account no longer has, or
            older than recipient records: whichever it was, a new one to the
            current address is one tap away (both answer the same way). */}
        <RefusedCodeNotice kind="link" />
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("Set your password")} blurb={record.user.email}>
      <SetPasswordForm token={token} purpose="invite" />
    </AuthShell>
  );
}
