import Link from "next/link";

import { PlainHeader } from "@/components/app/plain-header";
import { SecurityPanel } from "@/components/account/security-panel";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Everyone's own account, whatever their role: password, trusted browsers and
 * the sign-in trail. Nothing here reaches another account.
 */
export default async function AccountPage() {
  const user = await requireUser();
  const { t } = await getTranslator();

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
      <PlainHeader roleLabel={roleLabel} />

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "34px 28px 70px" }}>
        <Link href="/" className="btn btn-ghost" style={{ marginBottom: 16 }}>
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
      </div>
    </>
  );
}
