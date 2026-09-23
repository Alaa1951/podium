import type { SeriesScreenProps } from "@/screens/types";

import { CrmIntakeList } from "@/components/admin/crm-intake-list";
import { RegisteredTable } from "@/components/admin/registered-table";
import { can, isBft } from "@/lib/access";
import { crmIntakeFor } from "@/lib/actions/crm-sync";
import { getTranslator } from "@/lib/i18n/server";
import { getWaitingRoster } from "@/lib/queries";
import { toRegisteredRow } from "@/lib/registered-rows";
import { requireSeries } from "@/lib/require-series";
import { requireAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * REGISTERED, AND NOT IN THE FIELD.
 *
 * Two groups, two different problems, one screen — because from where BFT
 * MENA stands they are one question: who entered and still is not competing.
 * Until this screen there was no number for either of them anywhere in the
 * system, and both were folded into figures that read as work on the field.
 *
 * WAITING FOR A PLACE is ours to decide: the pair entered after registration
 * closed and someone has to let them in. NOT A TEAM YET is theirs: the CRM
 * form is unfinished and no decision here can fix it — those rows clear
 * themselves on the next poll after somebody completes the form.
 *
 * The admit and return buttons are the ones from the registrations screen,
 * not a second pair. `setWaitlist` handing out a place is the scarcest action
 * in the system, and it keeps exactly one call site.
 */
export default async function WaitingListScreen(props: SeriesScreenProps) {
  const user = await requireAccess("registrations.view");
  const { series } = await requireSeries(props.params);
  const { t } = await getTranslator();

  const [waiting, intake] = await Promise.all([
    getWaitingRoster(series.id, user),
    // The CRM half is BFT MENA's alone: it carries contact details for people
    // who have not finished registering. A studio sees its own waiting teams
    // and nothing else — and the menu badge counts the same way.
    isBft(user) ? crmIntakeFor(series.id) : Promise.resolve([]),
  ]);

  const rows = waiting.map(toRegisteredRow);

  return (
    <div className="screen">
      <div>
        <div className="page-eyebrow">{t("Registrations")}</div>
        <h1 className="page-title">{t("Waiting list")}</h1>
        <p>
          {t(
            "Everyone who registered and is not in the field. Either they entered after registration closed, or the CRM has not finished their registration."
          )}
        </p>
      </div>

      <section style={{ marginTop: 18 }}>
        <div className="console-group-title">
          {t("Waiting for a place")} · {rows.length}
        </div>
        {rows.length === 0 ? (
          <div className="notice" style={{ marginTop: 10 }}>
            {t("Nobody is waiting for a place.")}
          </div>
        ) : (
          <>
            <p className="reg-sub" style={{ marginTop: 4 }}>
              {t(
                "On the waiting list since registration closed. Admitting them gives them a place; it does not confirm any payment."
              )}
            </p>
            <RegisteredTable
              rows={rows}
              seriesId={series.id}
              canArchive={
                series.status === "scheduled" && !user.viewAs && can(user, "registrations.archive")
              }
              canWaitlist={!user.viewAs && can(user, "registrations.waitlist")}
              readOnly={!can(user, "registrations.payment") || !!user.viewAs}
            />
          </>
        )}
      </section>

      <CrmIntakeList
        rows={intake}
        intro={t(
          "{n} registrations in the CRM cannot be entered yet. Each one becomes a team by itself once its CRM form is finished.",
          { n: intake.length }
        )}
      />
    </div>
  );
}
