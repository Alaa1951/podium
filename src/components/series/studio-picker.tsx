"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { setSeriesStudio } from "@/lib/actions/series";

// ─────────────────────────────────────────────────────────────────────────────
// WHO IS TAKING PART.
//
// The step between creating a competition and anything happening in it, and
// the one that was missing. A studio on this list can register its teams here
// and follow its own entries; a studio in the directory but not on the list is
// simply not in this competition.
//
// What a studio may DO is one setting on the competition, not a setting per
// studio — the rule is the same for everybody in one PODIUM.
// ─────────────────────────────────────────────────────────────────────────────

export type StudioRow = {
  id: string;
  name: string;
  taking: boolean;
  teams: number;
  accounts: number;
};

export function StudioPicker({ seriesId, studios }: { seriesId: string; studios: StudioRow[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  function toggle(studio: StudioRow) {
    setMessage("");
    startTransition(async () => {
      const result = await setSeriesStudio({
        seriesId,
        studioId: studio.id,
        taking: !studio.taking,
      });
      if (!result.ok) {
        setMessage(
          result.error === "HAS_TEAMS"
            ? t("{name} has teams registered here. Move or remove them first.", {
                name: studio.name,
              })
            : t("Something went wrong. Try again.")
        );
        return;
      }
      router.refresh();
    });
  }

  const taking = studios.filter((s) => s.taking).length;

  return (
    <>
      {message ? (
        <div className="notice-error" role="alert" style={{ marginBottom: 12 }}>
          {message}
        </div>
      ) : null}

      <div className="picker-count">
        {t("{n} of {total} studios taking part", { n: taking, total: studios.length })}
      </div>

      <div className="picker-grid">
        {studios.map((studio) => (
          <button
            key={studio.id}
            type="button"
            className="picker-card"
            data-on={studio.taking || undefined}
            disabled={pending}
            onClick={() => toggle(studio)}
            aria-pressed={studio.taking}
          >
            <span className="picker-check" aria-hidden>
              {studio.taking ? "✓" : ""}
            </span>
            <span className="picker-body">
              <span className="picker-name">{studio.name}</span>
              <span className="picker-note">
                {studio.taking
                  ? studio.teams > 0
                    ? t("{n} team(s) registered", { n: studio.teams })
                    : t("no teams yet")
                  : t("not taking part")}
                {studio.accounts > 0
                  ? ` · ${t("{n} account(s)", { n: studio.accounts })}`
                  : ` · ${t("no accounts")}`}
              </span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
