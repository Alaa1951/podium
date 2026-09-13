import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser } from "@/lib/session";
import { getTranslator } from "@/lib/i18n/server";

export default async function LoginPage(props: PageProps<"/login">) {
  const user = await getCurrentUser();
  if (user) redirect("/");

  const { t } = await getTranslator();
  const params = await props.searchParams;

  // Only same-site paths are honoured, so a crafted ?callbackUrl= cannot bounce
  // a freshly signed-in operator to another origin.
  const raw = typeof params.callbackUrl === "string" ? params.callbackUrl : "/";
  const callbackUrl = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  return (
    <AuthShell
      title={t("Sign in")}
      blurb={t(
        "Accounts are issued, never self-created. BFT MENA adds each studio; a studio adds its own competitors."
      )}
    >
      <LoginForm callbackUrl={callbackUrl} />
    </AuthShell>
  );
}
