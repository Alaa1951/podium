import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser, homeForUser } from "@/lib/session";
import { getTranslator } from "@/lib/i18n/server";

export default async function LoginPage(props: PageProps<"/login">) {
  const user = await getCurrentUser();
  // The store shells open here on every launch. Go straight to the person's
  // home: "/" is streamed, so its own redirect for a non-admin arrives as a
  // meta refresh after a second full page load.
  if (user) redirect(await homeForUser(user));

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
        "Sign in with your email and password. Athletes who signed up here can use this door too."
      )}
    >
      <LoginForm callbackUrl={callbackUrl} />
    </AuthShell>
  );
}
