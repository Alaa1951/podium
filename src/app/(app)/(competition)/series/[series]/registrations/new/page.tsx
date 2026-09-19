import Link from "next/link";

import { RegistrationForm } from "@/components/admin/registration-form";
import { getTranslator } from "@/lib/i18n/server";
import { getSeriesStudios } from "@/lib/queries";
import { getSeriesReport } from "@/lib/reports";
import { requireSeries, seriesHref } from "@/lib/require-series";
import { requireAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Registering a pair by hand — the walk-up at the door, or a correction to
 * what the registration form sent. The same record the integration writes.
 *
 * Only studios taking part in THIS competition can be chosen as a competitor's
 * membership here, so the form cannot quietly place somebody under a studio
 * that is not in the room.
 */
export default async function NewRegistrationPage(
  props: PageProps<"/series/[series]/registrations/new">
) {
  await requireAccess("registrations.create");
  const { t } = await getTranslator();

  const { series } = await requireSeries(props.params);
  const [studios, report] = await Promise.all([
    getSeriesStudios(series.id),
    getSeriesReport(series.id),
  ]);

  const typicalMinor = report.paid > 0 ? Math.round(report.takingsMinor / report.paid) : 25000;

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <Link href={seriesHref(series.slug, "registrations")} className="linkish">
            ← {t("Registrations")}
          </Link>
          <h1 style={{ marginTop: 6 }}>{t("Register a pair")}</h1>
          <p>{series.name}</p>
        </div>
      </div>

      {studios.length === 0 ? (
        <div className="notice notice-warn">
          <strong>{t("No studios are taking part yet.")}</strong>{" "}
          {t("You can still register a pair, but neither of them can be marked as a member.")}{" "}
          <Link href={seriesHref(series.slug, "studios")} className="linkish">
            {t("Choose studios")}
          </Link>
        </div>
      ) : null}

      <RegistrationForm
        seriesId={series.id}
        studios={studios.map((studio) => ({ id: studio.id, name: studio.name }))}
        defaultAmount={(typicalMinor / 100).toFixed(2)}
        currency={report.currency}
      />
    </div>
  );
}
