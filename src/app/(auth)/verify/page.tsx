import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { VerifyForm } from "@/components/auth/verify-form";
import { getTranslator } from "@/lib/i18n/server";

export default async function VerifyPage(props: PageProps<"/verify">) {
  const params = await props.searchParams;
  const email = typeof params.email === "string" ? params.email : "";
  if (!email) redirect("/login");

  const rawCallback = typeof params.callbackUrl === "string" ? params.callbackUrl : "/";
  const callbackUrl =
    rawCallback.startsWith("/") && !rawCallback.startsWith("//") ? rawCallback : "/";
  const trust = params.trust !== "false";

  const { t } = await getTranslator();

  return (
    <AuthShell title={t("Verification required")}>
      <VerifyForm email={email} callbackUrl={callbackUrl} trust={trust} />
    </AuthShell>
  );
}
