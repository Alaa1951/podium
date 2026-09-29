"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { setTeamOwnership } from "@/lib/actions/ownership";
import type { Ownership } from "@/lib/ownership";

// ─────────────────────────────────────────────────────────────────────────────
// WHO REGISTERED THIS TEAM — BFT MENA's panel on a registration.
//
// The person who registered manages the team's membership; the other member
// can only leave. "Both registered separately" gives nobody power over the
// other's seat; "Not confirmed" gives nobody anything. The action re-checks
// all of it; this only chooses.
// ─────────────────────────────────────────────────────────────────────────────

const ERRORS: Record<string, string> = {
  SEAT_REQUIRED: "Choose the person who registered the team.",
  SEAT_HAS_NO_EMAIL: "That person has no email on the registration. Add one first.",
  SEAT_NOT_ON_TEAM: "That person is no longer on this team. Reload the page.",
  STALE_MEMBERSHIP: "This team changed while the page was open. Reload to see it as it is now.",
  NOT_FOUND: "That team could not be found.",
  FORBIDDEN: "You cannot change this.",
};

type Seat = { id: string; fullName: string; email: string | null };

export function OwnershipPanel({
  teamId,
  ownership,
  registrantSeatId,
  seats,
  readOnly,
  version,
}: {
  teamId: string;
  /** The team's membership version this page shows. */
  version: number;
  ownership: Ownership;
  /** The seat that resolves as the registrant today, if any. */
  registrantSeatId: string | null;
  seats: Seat[];
  readOnly: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initial = ownership === "registrant" && registrantSeatId ? `seat:${registrantSeatId}` : ownership === "registrant" ? "unknown" : ownership;
  const [choice, setChoice] = useState(initial);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function save() {
    setError("");
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await setTeamOwnership(
          choice.startsWith("seat:")
            ? { teamId, ownership: "registrant", registrantSeatId: choice.slice(5), expectedVersion: version }
            : { teamId, ownership: choice, expectedVersion: version }
        );
        if (!result.ok) {
          setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
          return;
        }
        setSaved(true);
        router.refresh();
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      }
    });
  }

  const options: { value: string; label: string; disabled?: boolean }[] = [
    ...seats.map((seat) => ({
      value: `seat:${seat.id}`,
      label: t("{name} registered the team", { name: seat.fullName }),
      disabled: !seat.email,
    })),
    { value: "joint", label: t("Both registered separately") },
    { value: "unknown", label: t("Not confirmed") },
  ];

  return (
    <section className="card" style={{ marginTop: 18 }}>
      <h2 style={{ margin: 0 }}>{t("Who registered this team")}</h2>
      <p className="reg-sub">
        {t("The person who registered manages who is on the team; the other member can only leave. Not confirmed gives nobody that right.")}
      </p>
      {ownership === "registrant" && !registrantSeatId ? (
        <div className="notice" role="status" style={{ marginBottom: 10 }}>
          {t("The registrant's email is no longer on either seat. Choose again.")}
        </div>
      ) : null}
      <div role="radiogroup" style={{ display: "grid", gap: 8 }}>
        {options.map((option) => (
          <label key={option.value} className="checkline">
            <input
              type="radio"
              name={`ownership-${teamId}`}
              value={option.value}
              checked={choice === option.value}
              disabled={readOnly || pending || option.disabled}
              onChange={() => setChoice(option.value)}
            />
            <span>
              {option.label}
              {option.disabled ? ` — ${t("no email on the registration")}` : ""}
            </span>
          </label>
        ))}
      </div>
      {error ? (
        <div className="notice-error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : null}
      {saved ? (
        <p className="reg-sub" role="status" style={{ marginBottom: 0 }}>
          {t("Saved.")}
        </p>
      ) : null}
      {readOnly ? null : (
        <div className="approval-actions">
          <button type="button" className="btn btn-primary" disabled={pending || choice === initial} onClick={save}>
            {pending ? <span className="spinner" /> : null}
            {t("Save")}
          </button>
        </div>
      )}
    </section>
  );
}
