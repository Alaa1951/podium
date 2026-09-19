import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";

/**
 * "Awaiting approval" / "Not approved" — shown on the home screens of anyone
 * whose sign-up has not been let in yet. Until then they see the general
 * pages only (permissions/load.ts), and this says why.
 */
export async function ApprovalBanner({ userId }: { userId: string }) {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { approvalStatus: true, rejectionReason: true, requestedStudio: { select: { name: true } } },
  });
  if (!row || row.approvalStatus === "approved") return null;
  const { t } = await getTranslator();

  if (row.approvalStatus === "rejected") {
    return (
      <section className="status-banner" data-tone="warn" role="status">
        <h2>{t("Your sign-up was not approved")}</h2>
        <p>
          {row.rejectionReason
            ? t("Reason: {reason}", { reason: row.rejectionReason })
            : t("Contact BFT MENA if you think this is a mistake.")}
        </p>
      </section>
    );
  }
  return (
    <section className="status-banner" role="status">
      <h2>{t("Awaiting approval")}</h2>
      <p>
        {row.requestedStudio
          ? t("{studio} or BFT MENA will review your sign-up. Until then you can open the general pages and the live board.", {
              studio: row.requestedStudio.name,
            })
          : t("BFT MENA will review your sign-up. Until then you can open the general pages and the live board.")}
      </p>
    </section>
  );
}
