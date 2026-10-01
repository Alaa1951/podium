import { notFound } from "next/navigation";

import { PlainHeader } from "@/components/app/plain-header";
import { PrintButton } from "@/components/waivers/print-button";
import { WaiverDocumentView } from "@/components/waivers/waiver-document";
import { can, isBft } from "@/lib/access";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { formatQatarDateTime } from "@/lib/qatar-time";
import { requireUser } from "@/lib/session";
import { parseEditionContent } from "@/lib/waivers/document";
import { loadReceipt } from "@/lib/waivers/waiver-db";

export const dynamic = "force-dynamic";

/**
 * A SIGNED WAIVER, READ BACK — read-only and made for printing: who signed,
 * how, when, which version and language, the exact sentence they ticked, and
 * the document exactly as it was stored when they signed it (its SHA-256 is
 * checked against the record). The athlete's own; BFT MENA with
 * `waivers.manage` may read anybody's. Anybody else gets a plain 404.
 */
export default async function WaiverReceiptScreen(params: Promise<{ id: string }>) {
  const { id } = await params;
  const user = await requireUser();
  const { t } = await getTranslator();
  const record = await loadReceipt(prisma, id, { id: user.id, mayReadAll: !user.viewAs && isBft(user) && can(user, "waivers.manage") });
  if (!record) notFound();
  const doc = parseEditionContent(record.edition.content);
  const signer = await prisma.user.findUnique({ where: { id: record.userId }, select: { name: true, email: true } });
  const dir = record.language === "ar" ? "rtl" : "ltr";

  return (
    <>
      <PlainHeader roleLabel={t("Waiver receipt")} homeHref="/me" backHref={`/waivers?series=${record.seriesId}`} />
      <div className="screen waiver-receipt" data-testid="waiver-receipt">
        <div className="screen-head waiver-receipt-head">
          <h1>{t("Waiver acceptance receipt")}</h1>
          <PrintButton label={t("Print")} />
        </div>
        <section className="card">
          <dl className="waiver-receipt-facts">
            <div><dt>{t("Competition")}</dt><dd>{record.release.series.name}</dd></div>
            <div><dt>{t("Account")}</dt><dd>{signer?.name ?? "—"} · {signer?.email ?? "—"}</dd></div>
            <div><dt>{t("Category and level when signed")}</dt><dd>{t(record.category)} {t(record.division)}</dd></div>
            <div><dt>{t("Waiver version")}</dt><dd className="pd-num">{record.release.version}</dd></div>
            <div><dt>{t("Language signed")}</dt><dd>{record.language === "ar" ? "العربية" : "English"}</dd></div>
            <div><dt>{t("Signature")}</dt><dd className="waiver-signature-shown" dir="auto" data-testid="receipt-signature">{record.typedName}</dd></div>
            <div><dt>{t("Signature method")}</dt><dd>{t("Full name typed by the athlete, with “Agree & Sign” (electronic signature)")}</dd></div>
            <div><dt>{t("Accepted at")}</dt><dd className="pd-num">{formatQatarDateTime(record.acceptedAt)} ({t("Qatar time")}) · {record.acceptedAt.toISOString()}</dd></div>
            <div><dt>{t("Acknowledgement accepted")}</dt><dd lang={record.language} dir={dir}>{record.acknowledgement}</dd></div>
            <div>
              <dt>{t("Document fingerprint (SHA-256)")}</dt>
              <dd className="pd-num waiver-hash">
                {record.contentHash.slice(0, 16)}…{" "}
                {record.contentIntact
                  ? <span className="badge badge-ok" data-testid="receipt-intact">{t("Matches the signed document")}</span>
                  : <span className="badge badge-danger">{t("Does not match — report this to BFT MENA")}</span>}
              </dd>
            </div>
          </dl>
        </section>
        <h2 className="waiver-receipt-doc-title">{t("The document as signed")}</h2>
        <WaiverDocumentView blocks={doc.blocks} language={record.language} dir={dir} />
      </div>
    </>
  );
}
