import Link from "next/link";

import { getTranslator } from "@/lib/i18n/server";
import { getPartnerWatch, type PartnerWatchPerson } from "@/lib/partner-watch";
import { requireAccess } from "@/lib/session";
import { requireSeries } from "@/lib/require-series";

export const dynamic = "force-dynamic";

/**
 * THE PEOPLE WITH NOBODY YET.
 *
 * Four lists, and the job they exist for is to pick up a phone. So unlike the
 * athlete's own finder, this one carries an address and a number — see the
 * header of partner-watch.ts for where that boundary sits and why.
 *
 * Read-only on purpose. Registering a pair is `registrations.create`'s screen,
 * one link away; adding a second way to do it here would mean two places to
 * keep in step.
 */
export default async function PartnerWatchScreen(
  params: Promise<{ series: string }>,
  studioScoped: boolean
) {
  const user = await requireAccess("registrations.partners");
  const { series } = await requireSeries(params);
  const { t } = await getTranslator();

  const watch = await getPartnerWatch({
    seriesId: series.id,
    studioId: studioScoped && user.role === "studio" ? user.studioId : null,
  });

  const registerHref = studioScoped
    ? `/studio/${series.slug}/teams`
    : `/series/${series.slug}/registrations/new`;

  const Person = ({ person }: { person: PartnerWatchPerson }) => (
    <>
      <td data-label={t("Name")}>
        <strong>{person.name}</strong>
      </td>
      <td data-label={t("Bracket")}>
        {[person.division, person.category].filter(Boolean).map((v) => t(String(v))).join(" · ") || "—"}
      </td>
      <td data-label={t("Studio")}>{person.studioName ?? t("No studio")}</td>
      <td data-label={t("Email")}>
        <a href={`mailto:${person.email}`}>{person.email}</a>
      </td>
      <td data-label={t("Phone")} dir="ltr">
        {person.phone ? <a href={`tel:${person.phone}`}>{person.phone}</a> : "—"}
      </td>
    </>
  );

  const heads = (
    <tr>
      <th>{t("Name")}</th>
      <th>{t("Bracket")}</th>
      <th>{t("Studio")}</th>
      <th>{t("Email")}</th>
      <th>{t("Phone")}</th>
    </tr>
  );

  const empty = <p className="reg-sub">{t("Nobody here yet.")}</p>;

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>{t("Partner watch")}</h1>
      </div>
      <p className="reg-sub">
        {t(
          "Athletes in this competition who still have nobody, or who have somebody but no entry. The lists overlap on purpose."
        )}
      </p>

      {/* The one that costs entries when nobody looks: two people agreed and
          nothing happened. */}
      <h2 className="section-title">
        {t("Paired, not registered")} · {watch.pairedNotRegistered.length}
      </h2>
      {watch.pairedNotRegistered.length === 0 ? (
        empty
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t("Pair")}</th>
                <th>{t("Bracket")}</th>
                <th>{t("Studio")}</th>
                <th>{t("Email")}</th>
                <th>{t("Phone")}</th>
              </tr>
            </thead>
            <tbody>
              {watch.pairedNotRegistered.map((pair) => (
                <tr key={`${pair.a.userId}:${pair.b.userId}`}>
                  <td data-label={t("Pair")}>
                    <strong>
                      {pair.a.name} &amp; {pair.b.name}
                    </strong>
                  </td>
                  <td data-label={t("Bracket")}>
                    {[pair.a.division, pair.a.category].filter(Boolean).map((v) => t(String(v))).join(" · ") || "—"}
                  </td>
                  <td data-label={t("Studio")}>
                    {[pair.a.studioName, pair.b.studioName].filter(Boolean).join(" · ") || t("No studio")}
                  </td>
                  <td data-label={t("Email")}>
                    <a href={`mailto:${pair.a.email}`}>{pair.a.email}</a>
                    <br />
                    <a href={`mailto:${pair.b.email}`}>{pair.b.email}</a>
                  </td>
                  <td data-label={t("Phone")} dir="ltr">
                    {pair.a.phone ?? "—"}
                    <br />
                    {pair.b.phone ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {watch.pairedNotRegistered.length > 0 ? (
        <Link href={registerHref} className="btn btn-primary" style={{ marginTop: 12 }}>
          {t("Register a team")}
        </Link>
      ) : null}

      <h2 className="section-title">
        {t("Looking for a partner")} · {watch.looking.length}
      </h2>
      {watch.looking.length === 0 ? (
        empty
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>{heads}</thead>
            <tbody>
              {watch.looking.map((person) => (
                <tr key={person.userId}>
                  <Person person={person} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section-title">
        {t("Waiting on an answer")} · {watch.asking.length}
      </h2>
      {watch.asking.length === 0 ? (
        empty
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t("Asked")}</th>
                <th>{t("Waiting on")}</th>
                <th>{t("Bracket")}</th>
                <th>{t("Email")}</th>
              </tr>
            </thead>
            <tbody>
              {watch.asking.map((ask) => (
                <tr key={ask.id}>
                  <td data-label={t("Asked")}>
                    <strong>{ask.from.name}</strong>
                  </td>
                  <td data-label={t("Waiting on")}>{ask.to.name}</td>
                  <td data-label={t("Bracket")}>
                    {[ask.from.division, ask.from.category].filter(Boolean).map((v) => t(String(v))).join(" · ") || "—"}
                  </td>
                  <td data-label={t("Email")}>
                    <a href={`mailto:${ask.from.email}`}>{ask.from.email}</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section-title">
        {t("Signed up, no team yet")} · {watch.unteamed.length}
      </h2>
      {watch.unteamed.length === 0 ? (
        empty
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>{heads}</thead>
            <tbody>
              {watch.unteamed.map((person) => (
                <tr key={person.userId}>
                  <Person person={person} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
