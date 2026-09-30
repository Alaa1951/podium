import { BracketChange } from "@/components/bracket/bracket-change";
import type { Category, Division } from "@/generated/prisma/enums";
import { loadBracketFacts } from "@/lib/bracket-data";
import { getTranslator } from "@/lib/i18n/server";

/**
 * The team's category and level on the athlete's own page, and their own
 * button to change it. The bracket is the TEAM's, not one person's: both
 * members see the same, and either may change it until the cutoff.
 *
 * What is on offer is worked out by the rules the server applies on save
 * (bracket.ts) — an athlete never moves a team into or out of Pro, and their
 * own door closes at the competition's cutoff (Settings → Team changes).
 */
export async function MyBracket({
  teamId,
  category,
  division,
  canChange,
}: {
  teamId: string;
  category: Category;
  division: Division;
  /** Holds `athleteHome.editTeam`, and is not an admin's read-only preview. */
  canChange: boolean;
}) {
  const { t } = await getTranslator();
  const facts = canChange ? (await loadBracketFacts([teamId], { role: "competitor" }, "athlete"))[teamId] ?? null : null;

  return (
    <section className="card" style={{ marginTop: 18 }} id="bracket">
      <div className="card-kicker">{t("Category and level")}</div>
      <div className="chip-row">
        <span className="badge badge-blue">{t(category)}</span>
        <span className="badge badge-blue">{t(division)}</span>
      </div>
      {facts ? (
        <BracketChange facts={facts} mode="athlete" />
      ) : (
        <p className="field-note" style={{ margin: "8px 0 0" }}>
          {t("To change your category or level, ask your studio or BFT MENA.")}
        </p>
      )}
    </section>
  );
}
