import { fmt } from "@/lib/scoring";
import { getTranslator } from "@/lib/i18n/server";

/**
 * ONE TEAM'S RESULT.
 *
 * The total, then the movements behind it — what the judge wrote down for each
 * zone and what that came to. This is the page somebody sends to their friend,
 * so the numbers that decided the day are the numbers on it.
 */
export async function PublicTeamResult({
  rank,
  fieldSize,
  name,
  competitors,
  studioName,
  category,
  division,
  total,
  zones,
}: {
  rank: number;
  fieldSize: number;
  name: string;
  competitors: string[];
  studioName: string | null;
  category: string;
  division: string;
  total: number;
  zones: {
    number: number;
    name: string;
    points: number;
    inputs: { label: string; unit: string; value: number | null }[];
  }[];
}) {
  const { t } = await getTranslator();

  return (
    <>
      <div className="pt-rank" data-rank={rank <= 3 ? rank : undefined}>
        #{rank} {t("of")} {fieldSize}
      </div>

      <h1 className="pt-name">{competitors.length ? competitors.join(" & ") : name}</h1>

      <div className="pt-meta">
        {[studioName, t(category), t(division)].filter(Boolean).join(" · ")}
      </div>

      <div className="pt-total-label">{t("Total score")}</div>
      <div className="pt-total">{fmt(total, 2)}</div>

      <div className="pt-zones">
        {zones.map((zone) => (
          <article key={zone.number} className="pt-zone">
            <div className="pt-zone-head">
              <span className="pt-zone-no">
                {t("Zone")} {zone.number}
              </span>
              <span className="pt-zone-slash">{"///"}</span>
              <span className="pt-zone-name">{t(zone.name)}</span>
            </div>

            <dl className="pt-zone-rows">
              {zone.inputs.map((input) => (
                <div key={input.label}>
                  <dt>{t(input.label)}</dt>
                  <dd className="pd-num">
                    {input.value === null
                      ? "—"
                      : `${input.value}${input.unit ? " " + input.unit : ""}`}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="pt-zone-points">
              <span className="pd-num">{fmt(zone.points, Number.isInteger(zone.points) ? 0 : 2)}</span>
              <span className="pt-zone-pts">{t("pts")}</span>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
