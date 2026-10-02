"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { StaffPersonPicker } from "@/components/floor/staff-person-picker";
import { useT } from "@/components/i18n/locale-provider";
import { addZoneStaff, removeZoneStaff, setZoneStaffStation } from "@/lib/actions/zone-staff";

// ─────────────────────────────────────────────────────────────────────────────
// ZONE TEAMS — who works each zone for the whole competition.
//
// One or more leaders per zone, then judges and reserves. Whoever holds
// zoneStaff.assign puts people on zones and picks the leaders; a leader
// places judges on stations from their own sheet, and so can this panel.
// zoneStaff.assignJudges (the Zone Leaders role) staffs the zones they lead:
// judges and reserves on and off, leaders out of reach.
// Several people on one station is allowed, and shown as a warning.
// ─────────────────────────────────────────────────────────────────────────────

type Position = "leader" | "judge" | "reserve";

export type ZoneStaffRow = {
  id: string;
  userId: string;
  position: Position;
  station: number | null;
  name: string;
  email: string;
};

const ERRORS: Record<string, string> = {
  NOT_A_JUDGE: "That person does not hold the Judge role. Give it to them first.",
  NOT_FOUND: "That person or zone no longer exists.",
  FORBIDDEN: "You are not allowed to do that.",
};

export function ZoneStaffPanel({
  zones,
  candidates,
  canAssign,
  canAssignJudges = false,
  ledZoneIds = [],
  canPlace = false,
  stations,
  title,
}: {
  zones: { id: string; number: number; name: string; staff: ZoneStaffRow[] }[];
  candidates: { id: string; label: string }[];
  /**
   * How many stations the floor actually runs — the competition's capacity,
   * not MAX_STATIONS. A judge cannot stand at a rig that is not set up, and
   * offering the number invites somebody to pick it.
   */
  stations: number;
  /** zoneStaff.assign: add, remove, pick the leader, place anyone. */
  canAssign: boolean;
  /** zoneStaff.assignJudges: add and remove judges and reserves on ledZoneIds only. */
  canAssignJudges?: boolean;
  /** The zones of this competition the viewer leads — the reach of assignJudges. */
  ledZoneIds?: string[];
  /** A zone leader: place the judges and reserves of these zones on stations. */
  canPlace?: boolean;
  title?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [picks, setPicks] = useState<Record<string, { userId: string; position: Position }>>({});

  const positionLabel = (position: Position) =>
    position === "leader" ? t("Zone leader") : position === "reserve" ? t("Reserve") : t("Judge");

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setError("");
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) setError(t(ERRORS[result.error ?? ""] ?? "Something went wrong. Try again."));
        router.refresh();
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      }
    });
  }

  return (
    <section style={{ marginTop: 24 }}>
      <h2 className="section-title">{title ?? t("Zone teams")}</h2>
      <p className="reg-sub" style={{ maxWidth: "70ch" }}>
        {t(
          "Access is per zone, for the whole competition. Each zone can have one or more leaders, who place the judges and reserves on the stations. A judge scores only the team on their station, in whichever wave is in their zone."
        )}
      </p>
      {error ? (
        <div className="notice-error" role="alert" style={{ marginBottom: 10 }}>
          {error}
        </div>
      ) : null}

      <div className="zone-staff-grid">
        {zones.map((zone) => {
          const counts = new Map<number, number>();
          for (const row of zone.staff) if (row.station) counts.set(row.station, (counts.get(row.station) ?? 0) + 1);
          const pick = picks[zone.id] ?? { userId: "", position: "judge" as Position };
          const onZone = new Set(zone.staff.map((row) => row.userId));
          // Full assigners work every zone; the judges-only role works the
          // zones they lead, and leaders stay out of their reach.
          const zoneAssignable = canAssign || (canAssignJudges && ledZoneIds.includes(zone.id));
          return (
            <section key={zone.id} className="card">
              <h3 style={{ marginTop: 0 }}>
                {t("Zone")} {zone.number} · {t(zone.name)}
              </h3>
              {!zone.staff.some((row) => row.position === "leader") ? (
                <p className="perm-lock">{t("No zone leader yet")}</p>
              ) : null}
              {zone.staff.length === 0 ? <p className="reg-sub">{t("Nobody on this zone yet.")}</p> : null}
              {zone.staff.map((row) => (
                <div key={row.id} className="perm-row" data-effective="true">
                  <span className="perm-row-label">
                    <span className={`badge ${row.position === "leader" ? "badge-cyan" : "badge-neutral"}`}>
                      {positionLabel(row.position)}
                    </span>
                    <span>{row.name}</span>
                  </span>
                  {row.position !== "leader" ? (
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span className="reg-sub">{t("Station")}</span>
                      <select
                        className="input pd-num"
                        style={{ width: 76 }}
                        value={row.station ?? ""}
                        disabled={pending || !(canAssign || canPlace)}
                        onChange={(e) =>
                          run(() =>
                            setZoneStaffStation({ staffId: row.id, station: e.target.value ? Number(e.target.value) : null })
                          )
                        }
                      >
                        <option value="">—</option>
                        {/* Never fewer than the station this person already
                            holds, or lowering the capacity would blank their
                            row and hide where they are standing. */}
                        {Array.from({ length: Math.max(stations, row.station ?? 0) }, (_, index) => (
                          <option key={index + 1} value={index + 1}>
                            {index + 1}
                          </option>
                        ))}
                      </select>
                      {row.station && (counts.get(row.station) ?? 0) > 1 ? (
                        <span className="perm-lock">{t("Shared station")}</span>
                      ) : null}
                    </label>
                  ) : null}
                  {canAssign || zoneAssignable ? (
                    <span style={{ display: "inline-flex", gap: 6 }}>
                      {canAssign && row.position !== "leader" ? (
                        <button
                          type="button"
                          className="chip-sm"
                          disabled={pending}
                          onClick={() => run(() => addZoneStaff({ zoneId: zone.id, userId: row.userId, position: "leader" }))}
                        >
                          {t("Make leader")}
                        </button>
                      ) : null}
                      {canAssign || row.position !== "leader" ? (
                        <button
                          type="button"
                          className="chip-sm"
                          disabled={pending}
                          onClick={() => {
                            if (window.confirm(t("Take {name} off this zone?", { name: row.name }))) {
                              run(() => removeZoneStaff({ staffId: row.id }));
                            }
                          }}
                        >
                          {t("Remove")}
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              ))}

              {zoneAssignable ? (
                <div className="form-row zone-staff-assignment" style={{ marginTop: 10 }}>
                  <StaffPersonPicker
                    candidates={candidates.filter((person) => !onZone.has(person.id))}
                    value={pick.userId}
                    disabled={pending}
                    onChange={(userId) => setPicks((current) => ({ ...current, [zone.id]: { ...pick, userId } }))}
                  />
                  <label style={{ flex: "1 1 120px" }}>
                    <span className="field-label">{t("As")}</span>
                    <select
                      className="input"
                      value={pick.position}
                      disabled={pending}
                      onChange={(e) =>
                        setPicks((current) => ({ ...current, [zone.id]: { ...pick, position: e.target.value as Position } }))
                      }
                    >
                      <option value="judge">{t("Judge")}</option>
                      <option value="reserve">{t("Reserve")}</option>
                      {canAssign ? <option value="leader">{t("Zone leader")}</option> : null}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={pending || !pick.userId || onZone.has(pick.userId)}
                    onClick={() => {
                      run(() => addZoneStaff({ zoneId: zone.id, userId: pick.userId, position: pick.position }));
                      setPicks((current) => ({ ...current, [zone.id]: { userId: "", position: "judge" } }));
                    }}
                  >
                    {t("Add")}
                  </button>
                </div>
              ) : null}
            </section>
          );
        })}
        {zones.length === 0 ? <p className="reg-sub">{t("This competition has no zones yet — add them in Settings.")}</p> : null}
      </div>
      {(canAssign || canAssignJudges) && candidates.length === 0 ? (
        <p className="reg-sub" style={{ marginTop: 10 }}>
          {t("Nobody holds the Judge role yet. Give it to people from their Access panel first.")}
        </p>
      ) : null}
    </section>
  );
}
