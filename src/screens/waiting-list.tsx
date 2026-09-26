import type { SeriesScreenProps } from "@/screens/types";

import { CrmIntakeList } from "@/components/admin/crm-intake-list";
import { RegisteredTable } from "@/components/admin/registered-table";
import { can, canAny, isAdmin, isBft } from "@/lib/access";
import { crmIntakeFor } from "@/lib/crm/intake";
import { getTranslator } from "@/lib/i18n/server";
import { getWaitingRoster } from "@/lib/queries";
import { listStudios } from "@/lib/queries-people";
import { toRegisteredRow } from "@/lib/registered-rows";
import { requireSeries } from "@/lib/require-series";
import { requireConsoleAccess } from "@/lib/session";

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
 *
 * ONE HALF OF THAT IS NO LONGER TRUE, and it is the better half: a CRM row can
 * now be finished from here. "Theirs" assumed the person would go back to the
 * form, and thirty people on the live CRM have not — they paid, left, and have
 * no account to come back to. So staff fill in the missing answers and PODIUM
 * writes them TO THE CRM; the row still clears by the ordinary route, on the
 * next poll, as a team. Nothing about who owns the record changes.
 */
export default async function WaitingListScreen(props: SeriesScreenProps) {
  const user = await requireConsoleAccess("registrations.view");
  const { series } = await requireSeries(props.params);
  const { t } = await getTranslator();

  const [waiting, intake, studios] = await Promise.all([
    getWaitingRoster(series.id, user),
    // The CRM half is BFT MENA's alone: it carries contact details for people
    // who have not finished registering. A studio sees its own waiting teams
    // and nothing else — and the menu badge counts the same way.
    isBft(user) ? crmIntakeFor(series.id) : Promise.resolve([]),
    // ALL studios, not this competition's. A second athlete's BFT membership is
    // a fact about them, and the CRM's studio list is its own — a studio absent
    // from this competition still exists and people still belong to it.
    isBft(user) ? listStudios() : Promise.resolve([]),
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
              canOverridePayment={!user.viewAs && isAdmin(user)}
              readOnly={!canAny(user, ["registrations.attendance", "registrations.payment"]) || !!user.viewAs} canEdit={!user.viewAs && can(user, "registrations.edit")}
            />
          </>
        )}
      </section>

      <CrmIntakeList
        rows={intake}
        seriesId={series.id}
        studioNames={studios.map((studio) => studio.name)}
        // Same key as "Sync now" and the by-hand registration form: this
        // finishes a registration, and a NEW permission key would ship the
        // button invisible to everyone but an admin unless a migration wrote it
        // into every role. That has happened twice here.
        canComplete={!user.viewAs && can(user, "registrations.create")}
        intro={t(
          "{n} registrations in the CRM cannot be entered yet. Each one becomes a team by itself once its CRM form is finished.",
          { n: intake.length }
        )}
      />
    </div>
  );
}
