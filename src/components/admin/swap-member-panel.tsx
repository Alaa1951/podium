"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { swapTeamMember } from "@/lib/actions/team-swap";
import type { SwapCandidate, SwapDoor } from "@/lib/team-swap";

// ─────────────────────────────────────────────────────────────────────────────
// SWAPPING SOMEBODY ON A TEAM — the staff panel.
//
// When the door is shut the reason is SHOWN, not hidden: a member of staff on
// the floor needs to know it is the wave that stopped them, not a broken
// screen. The action re-checks every rule; nothing here is a permission.
// ─────────────────────────────────────────────────────────────────────────────

/** Keyed on the door's own reasons, so a new one is a compile error here. */
const CLOSED: Record<Extract<SwapDoor, { open: false }>["reason"], string> = {
  SERIES_FINISHED: "This competition is finished. Its field is the record now.",
  TEAM_ALREADY_SCORED: "This team has a score. Nobody can be swapped out of a scored team.",
  WAVE_STARTED: "This team's wave has started. Nobody can be swapped once they are on the floor.",
  REGISTRATION_CLOSED: "Registration has closed. Ask BFT MENA to change who is on this team.",
};

const ERRORS: Record<string, string> = {
  NAME_REQUIRED: "Choose an athlete or type the substitute's name.",
  NOT_FOUND: "That team member could not be found.",
  ATHLETE_NOT_FOUND: "That athlete could not be used. They may already be entered.",
  ALREADY_ENTERED: "That athlete is already entered in this competition.",
  SAME_ATHLETE: "That is the other person on this team.",
  EMAIL_INVALID: "That email does not look right.",
  SERIES_FINISHED: CLOSED.SERIES_FINISHED,
  TEAM_ALREADY_SCORED: CLOSED.TEAM_ALREADY_SCORED,
  WAVE_STARTED: CLOSED.WAVE_STARTED,
  REGISTRATION_CLOSED: CLOSED.REGISTRATION_CLOSED,
  FORBIDDEN: "You cannot change this.",
};

export function SwapMemberPanel({
  competitorId,
  fullName,
  door,
  candidates,
}: {
  competitorId: string;
  fullName: string;
  door: SwapDoor;
  candidates: SwapCandidate[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [typedIn, setTypedIn] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [form, setForm] = useState({
    replacementUserId: "",
    fullName: "",
    email: "",
    phone: "",
  });

  const set = <K extends keyof typeof form>(key: K, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  if (!door.open) {
    return (
      <section className="card" style={{ marginTop: 18 }}>
        <h2 style={{ margin: 0 }}>{t("Swap this person out")}</h2>
        <p className="reg-sub" style={{ marginBottom: 0 }}>
          {t(CLOSED[door.reason])}
        </p>
      </section>
    );
  }

  function submit() {
    setError("");
    setDone("");
    startTransition(async () => {
      try {
        const result = await swapTeamMember(
          typedIn
            ? { competitorId, fullName: form.fullName, email: form.email, phone: form.phone }
            : { competitorId, replacementUserId: form.replacementUserId }
        );
        if (!result.ok) {
          setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
          return;
        }
        setDone(t("Swapped. The team keeps its number, wave and station."));
        setOpen(false);
        router.refresh();
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      }
    });
  }

  return (
    <section className="card" style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>{t("Swap this person out")}</h2>
        {!open ? (
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
            {t("Swap")}
          </button>
        ) : null}
      </div>

      {!open ? (
        <p className="reg-sub" style={{ marginBottom: 0 }}>
          {t("Somebody else takes {name}'s place on this team. The team keeps its number, wave and station.", {
            name: fullName,
          })}
        </p>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="seg seg-lg" role="group" style={{ marginBottom: 12 }}>
            <button type="button" data-active={!typedIn || undefined} disabled={pending} onClick={() => setTypedIn(false)}>
              {t("An athlete with an account")}
            </button>
            <button type="button" data-active={typedIn || undefined} disabled={pending} onClick={() => setTypedIn(true)}>
              {t("Type in a substitute")}
            </button>
          </div>

          {!typedIn ? (
            candidates.length ? (
              <label>
                <span className="field-label">{t("Who takes their place")}</span>
                <select
                  className="input"
                  value={form.replacementUserId}
                  disabled={pending}
                  onChange={(event) => set("replacementUserId", event.target.value)}
                >
                  <option value="">{t("Choose an athlete")}</option>
                  {candidates.map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.studioName ? `${one.name} · ${one.studioName}` : one.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="reg-sub">
                {t("No athlete with an account is free to take this place. Type the substitute in instead.")}
              </p>
            )
          ) : (
            <div className="form-row">
              <label style={{ flex: "1 1 200px" }}>
                <span className="field-label">{t("Full name")}</span>
                <input
                  className="input"
                  value={form.fullName}
                  maxLength={120}
                  disabled={pending}
                  onChange={(event) => set("fullName", event.target.value)}
                />
              </label>
              <label style={{ flex: "1 1 200px" }}>
                <span className="field-label">{t("Email (optional)")}</span>
                <input
                  className="input"
                  type="email"
                  value={form.email}
                  maxLength={200}
                  disabled={pending}
                  onChange={(event) => set("email", event.target.value)}
                />
              </label>
              <label style={{ flex: "1 1 160px" }}>
                <span className="field-label">{t("Phone (optional)")}</span>
                <input
                  className="input"
                  type="tel"
                  value={form.phone}
                  maxLength={30}
                  disabled={pending}
                  onChange={(event) => set("phone", event.target.value)}
                />
              </label>
            </div>
          )}

          {error ? (
            <div className="notice-error" role="alert" style={{ marginTop: 10 }}>
              {error}
            </div>
          ) : null}

          <div className="approval-actions">
            <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>
              {t("Swap them in")}
            </button>
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setOpen(false)}>
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}

      {done ? (
        <p className="reg-sub" role="status">
          {done}
        </p>
      ) : null}
    </section>
  );
}
