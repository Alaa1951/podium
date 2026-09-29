import { getTranslator } from "@/lib/i18n/server";
import { managingSeat, type Ownership } from "@/lib/ownership";

// ─────────────────────────────────────────────────────────────────────────────
// YOUR PAIR — who is on the team, and where each of them stands.
//
// Read-only (release R2a). Beside each name: whether that person can already
// see the team (they have signed in), has been added but not signed in yet,
// or has no email to sign in with — and which of them registered the team.
// A team of one says a partner is needed. Changing any of it is BFT MENA's,
// or the registrant's once athlete membership changes are switched on.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A small label beside a name. Not `.chip`: on phones that class wraps and
 * grows into a bubble around a two-line status.
 */
const label = (accent: boolean) => ({
  display: "inline-block",
  fontSize: 12,
  lineHeight: 1.4,
  padding: "2px 8px",
  borderRadius: 6,
  border: `1px solid ${accent ? "var(--bft-cyan)" : "var(--border)"}`,
  color: accent ? "var(--bft-cyan-text)" : "var(--text-secondary)",
  maxWidth: "100%",
  overflowWrap: "anywhere" as const,
});

export type PairMember = {
  id: string;
  fullName: string;
  email: string | null;
  userId: string | null;
  studioName: string | null;
  shirt: string | null;
};

export async function PairCard({
  members,
  viewerId,
  ownership,
  viewerCanFill = false,
}: {
  members: PairMember[];
  /** The signed-in athlete, to mark "you". */
  viewerId: string;
  /** The viewer can add the partner themselves (the button follows the card). */
  viewerCanFill?: boolean;
  ownership: { ownership: Ownership; registrantEmail: string | null; registrantUserId: string | null; payerEmail?: string | null };
}) {
  const { t } = await getTranslator();
  // Confirmed by BFT MENA, or — until they do — the automatic registrant.
  const registrant = managingSeat({ ...ownership, competitors: members });
  const registrantLabel = ownership.ownership === "unknown" ? t("Manages the team") : t("Registered the team");

  const standing = (member: PairMember) =>
    member.userId === viewerId
      ? t("You")
      : member.userId
        ? t("Signed in")
        : member.email
          ? t("Added — not signed in yet")
          : t("No email — ask BFT MENA to add one");

  return (
    <section className="card" style={{ marginTop: 8 }} aria-label={t("Your pair")}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 14 }}>
        {members.map((member) => (
          <li key={member.id} style={{ display: "grid", gap: 6, minWidth: 0 }}>
            <strong style={{ overflowWrap: "anywhere" }}>{member.fullName}</strong>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <span style={label(false)}>{standing(member)}</span>
              {registrant?.id === member.id ? <span style={label(true)}>{registrantLabel}</span> : null}
            </div>
            <span className="reg-sub" style={{ margin: 0 }}>
              {member.studioName ?? t("Non-member")} · {t("T-shirt: {size}", { size: member.shirt ?? "—" })}
            </span>
          </li>
        ))}
        {members.length < 2 ? (
          <li className="notice" style={{ margin: 0 }}>
            <strong>{t("Partner needed")}</strong>
            <p style={{ margin: "6px 0 0" }}>
              {viewerCanFill
                ? t("This team has one athlete so far. Add your partner with the button below.")
                : t("This team has one athlete so far. BFT MENA can add the partner.")}
            </p>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
