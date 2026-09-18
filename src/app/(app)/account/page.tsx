import Link from "next/link";

import { PlainHeader } from "@/components/app/plain-header";
import { SecurityPanel } from "@/components/account/security-panel";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { homeForUser, requireUser } from "@/lib/session";
import { SignOutButton } from "@/components/app/sign-out-button";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { getTheme } from "@/lib/theme-server";
import { LanguageSwitch } from "@/components/i18n/language-switch";

export const dynamic = "force-dynamic";

/**
 * Everyone's own account, whatever their role: password, trusted browsers and
 * the sign-in trail. Nothing here reaches another account.
 */
export default async function AccountPage() {
  const user = await requireUser();
  const { t } = await getTranslator();
  const [homeHref, theme] = await Promise.all([homeForUser(user),getTheme()]);

  const studio = user.studioId
    ? await prisma.studio.findUnique({ where: { id: user.studioId }, select: { name: true } })
    : null;

  const roleLabel =
    user.role === "admin"
      ? t("BFT MENA · full admin")
      : user.role === "studio"
        ? `${studio?.name ?? "—"} ${t("Studio").toLowerCase()}`
        : `${t("Member")} · ${user.name ?? user.email}`;

  return (
    <>
      <PlainHeader roleLabel={t("Account")} homeHref={homeHref} />

      <div className="page-shell" style={{ maxWidth: 900, margin: "0 auto", padding: "34px 28px 70px" }}>
        <Link href={homeHref} className="btn btn-ghost desktop-only" style={{ marginBottom: 16 }}>
          ← {t("Back")}
        </Link>

        <div className="page-head">
          <div className="page-eyebrow">{user.email}</div>
          <h1 className="page-title">{t("Account security")}</h1>
          <p className="page-sub">
            {t(
              "Your password, the browsers this account trusts, and every recent sign-in attempt against it."
            )}
          </p>
        </div>

        <SecurityPanel />
        <div className="mobile-only"><p>{roleLabel}</p><div style={{display:"flex",gap:16,flexWrap:"wrap",marginTop:24}}><LanguageSwitch /><ThemeToggle current={theme} /></div><div className="mobile-action-bar"><SignOutButton /></div></div>
      </div>
    </>
  );
}
