import Link from "next/link";

import { getTranslator } from "@/lib/i18n/server";
import { myWaivers } from "@/lib/waivers/my-waivers";

/**
 * The waiver on the athlete's own team page — a standing action until it is
 * signed, then a line with the receipt. Nothing when the competition asks
 * for no waiver.
 */
export async function WaiverCard({ userId, seriesId }: { userId: string; seriesId: string }) {
  const waiver = (await myWaivers(userId)).find((one) => one.series.id === seriesId);
  if (!waiver) return null;
  const { t } = await getTranslator();
  const href = `/waivers?series=${encodeURIComponent(seriesId)}`;
  if (waiver.state === "signed") {
    const current = waiver.signed.find((one) => one.current);
    return (
      <div className="notice waiver-card" data-testid="waiver-card" data-state="signed">
        <span className="badge badge-ok">{t("Waiver signed")}</span>{" "}
        {current ? <Link href={`/waivers/receipt/${current.id}`}>{t("View receipt")}</Link> : null}
      </div>
    );
  }
  return (
    <section className="card waiver-card waiver-card-action" data-testid="waiver-card" data-state={waiver.state}>
      <div>
        <strong>{t("Waiver Declarations")}</strong>
        <p style={{ margin: "4px 0 0" }}>
          {waiver.state === "resign"
            ? t("A new version of the waiver needs your signature before you can check in.")
            : t("Sign your waiver before you can check in at the entrance. Your partner signs their own.")}
        </p>
      </div>
      <Link href={href} className="btn btn-primary">{t("Read and sign")}</Link>
    </section>
  );
}
