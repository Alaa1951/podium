"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { setSeriesStatus, updateSeriesSettings } from "@/lib/actions/series";
import { waveLengthMinutes } from "@/lib/floor";
import { useUnsavedChanges } from "@/components/app/mobile-runtime";
import {
  BoardDisplay,
  Field,
  StudioPermissions,
} from "@/components/series/settings-sections";

// ─────────────────────────────────────────────────────────────────────────────
// EVERYTHING ABOUT A COMPETITION THAT IS A SETTING.
//
// Grouped the way somebody thinks about it rather than the way the table is
// laid out: what it is, when things close, what a studio may do, and what the
// board shows. The scoring definition is long enough to be its own section
// below this one.
// ─────────────────────────────────────────────────────────────────────────────

export type SeriesSettings = {
  id: string;
  slug: string;
  name: string;
  competitionDate: string;
  venue: string;
  status: "scheduled" | "live" | "final";
  firstWaveTime: string;
  waveMinutes: number;
  waveCapacity: number;
  zoneWorkMinutes: number;
  zoneBreakMinutes: number;
  boardOpensAt: string;
  registrationClosesAt: string;
  registrationsFinalAt: string;
  scoreEntryClosesAt: string;
  resultsPublicAt: string;
  championsAnnouncedAt: string;
  teamEditCloseHours: number;
  showTeamName: boolean;
  showCompetitorNames: boolean;
  showStudioColumn: boolean;
};

/** `readOnly`: the viewer holds settings.view but not settings.edit. */
export function SettingsForm({
  initial,
  readOnly = false,
  zoneCount = 0,
}: {
  initial: SeriesSettings;
  readOnly?: boolean;
  /** How many zones the wave rotates through — the wave length follows. */
  zoneCount?: number;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState(initial);
  const [message, setMessage] = useState("");
  const [baseline, setBaseline] = useState(JSON.stringify(initial));
  useUnsavedChanges(JSON.stringify(form) !== baseline);

  const set = <K extends keyof SeriesSettings>(key: K, value: SeriesSettings[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  function save() {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await updateSeriesSettings({ seriesId: form.id, ...form });
        if (!result.ok) {
          setMessage(
            result.error === "SERIES_DATE_INVALID"
              ? t("That date could not be read.")
              : t("Check the form — a required value is missing or out of range.")
          );
          return;
        }
        setMessage(t("Saved."));
        setBaseline(JSON.stringify(form));
        router.refresh();
      } catch { setMessage(t("Could not save. Check your connection and try again.")); }
    });
  }

  function changeStatus(status: SeriesSettings["status"]) {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await setSeriesStatus({ seriesId: form.id, status });
        if (result.ok) {
          set("status", status);
          setBaseline((previous) => JSON.stringify({ ...JSON.parse(previous), status }));
          router.refresh();
        } else {
          setMessage(t("Something went wrong. Try again."));
        }
      } catch { setMessage(t("Could not save. Check your connection and try again.")); }
    });
  }

  return (
    <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {message ? (
        <div className="notice" style={{ marginBottom: 14 }}>
          {message}
        </div>
      ) : null}

      {/* ── Where it is in its life ────────────────────────────────────────── */}
      <section className="form-block">
        <h2 className="section-title">{t("Status")}</h2>
        <p className="reg-sub" style={{ marginTop: 4 }}>
          {t(
            "What the board shows follows from this. A competition that is live shows the operator board; one that is final shows its results."
          )}
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {(["scheduled", "live", "final"] as const).map((status) => (
            <button
              key={status}
              type="button"
              className="chip"
              data-active={form.status === status || undefined}
              disabled={pending}
              onClick={() => changeStatus(status)}
            >
              {status === "scheduled"
                ? t("Scheduled")
                : status === "live"
                  ? t("Running")
                  : t("Finished")}
            </button>
          ))}
        </div>
      </section>

      {/* ── What it is ─────────────────────────────────────────────────────── */}
      <section className="form-block">
        <h2 className="section-title">{t("The competition")}</h2>
        <div className="form-row">
          <Field label={t("Name")} grow={2}>
            <input
              className="input"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label={t("Date and time")}>
            <input
              className="input pd-num"
              type="datetime-local"
              value={form.competitionDate}
              onChange={(e) => set("competitionDate", e.target.value)}
            />
          </Field>
          <Field label={t("Venue")}>
            <input
              className="input"
              value={form.venue}
              onChange={(e) => set("venue", e.target.value)}
            />
          </Field>
        </div>
        <p className="reg-sub">
          {t("Its address will be")} <code>/series/{form.slug}</code>
        </p>
      </section>

      {/* ── The floor ──────────────────────────────────────────────────────── */}
      <section className="form-block">
        <h2 className="section-title">{t("The floor")}</h2>
        <p className="reg-sub" style={{ marginTop: 4 }}>
          {t(
            "The supervisor presses Start once and the wave moves through every zone by itself: the work time in each zone, then the changeover, with no changeover after the last zone. Each team keeps one station (1–9) in every zone."
          )}
        </p>
        <div className="form-row">
          <Field label={t("First wave at")}>
            <input
              className="input pd-num"
              type="time"
              value={form.firstWaveTime}
              onChange={(e) => set("firstWaveTime", e.target.value)}
            />
          </Field>
          <Field label={t("Work per zone (minutes)")}>
            <input
              className="input pd-num"
              type="number"
              min={1}
              max={60}
              value={form.zoneWorkMinutes}
              onChange={(e) => set("zoneWorkMinutes", Number(e.target.value) || 1)}
            />
          </Field>
          <Field label={t("Changeover between zones (minutes)")}>
            <input
              className="input pd-num"
              type="number"
              min={0}
              max={30}
              value={form.zoneBreakMinutes}
              onChange={(e) => set("zoneBreakMinutes", Math.max(0, Number(e.target.value) || 0))}
            />
          </Field>
          <Field label={t("Teams per wave")} hint={t("one per station, nine at most")}>
            <input
              className="input pd-num"
              type="number"
              min={1}
              max={9}
              value={form.waveCapacity}
              onChange={(e) => set("waveCapacity", Math.min(9, Number(e.target.value) || 1))}
            />
          </Field>
        </div>
        <p className="reg-sub pd-num" style={{ marginTop: 8 }}>
          {t("Each wave runs {minutes} minutes across {zones} zones.", {
            minutes: waveLengthMinutes({
              workMinutes: form.zoneWorkMinutes,
              breakMinutes: form.zoneBreakMinutes,
              zoneCount,
            }),
            zones: zoneCount,
          })}
        </p>
      </section>

      {/* ── Deadlines ──────────────────────────────────────────────────────── */}
      <section className="form-block">
        <h2 className="section-title">{t("Key times")}</h2>
        <div className="form-row">
          <Field label={t("Board opens")} hint={t("what the countdown counts to")}>
            <input
              className="input pd-num"
              type="datetime-local"
              value={form.boardOpensAt}
              onChange={(e) => set("boardOpensAt", e.target.value)}
            />
          </Field>
          <Field label={t("Registration closes")}>
            <input
              className="input pd-num"
              type="datetime-local"
              value={form.registrationClosesAt}
              onChange={(e) => set("registrationClosesAt", e.target.value)}
            />
          </Field>
          <Field
            label={t("Registrations final")}
            hint={t("shown to studios; the lock is the date above")}
          >
            <input
              className="input pd-num"
              type="datetime-local"
              value={form.registrationsFinalAt}
              onChange={(e) => set("registrationsFinalAt", e.target.value)}
            />
          </Field>
          <Field label={t("Score entry closes")}>
            <input
              className="input pd-num"
              type="datetime-local"
              value={form.scoreEntryClosesAt}
              onChange={(e) => set("scoreEntryClosesAt", e.target.value)}
            />
          </Field>
          <Field label={t("Results go public")} hint={t("competitor-only until then")}>
            <input
              className="input pd-num"
              type="datetime-local"
              value={form.resultsPublicAt}
              onChange={(e) => set("resultsPublicAt", e.target.value)}
            />
          </Field>
          <Field
            label={t("International champions announced")}
            hint={t("a date to look forward to; nothing unlocks on it")}
          >
            <input
              className="input pd-num"
              type="datetime-local"
              value={form.championsAnnouncedAt}
              onChange={(e) => set("championsAnnouncedAt", e.target.value)}
            />
          </Field>
        </div>
      </section>

      <StudioPermissions form={form} set={set} />
      <BoardDisplay form={form} set={set} />

      <div className="mobile-action-bar" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" onClick={save} disabled={pending}>
          {pending ? <span className="spinner" /> : null}
          {t("Save settings")}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setForm(initial)}
          disabled={pending}
        >
          {t("Revert")}
        </button>
      </div>
    </fieldset>
  );
}
