"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { StudioTeamEditor } from "@/components/studio/studio-team-editor";
import { archiveTeam } from "@/lib/actions/team-people";
import { teamStatusLabel, teamStatusTone, type TeamStatus } from "@/lib/team-status";

// ─────────────────────────────────────────────────────────────────────────────
// THE TEAMS TAB.
//
// The manual's columns, in the manual's order: # / MEMBERS / CAT · DIV /
// STATUS / EDIT / REMOVE. A withdrawal asks first — it takes a pair out of a
// competition they paid for, and there is no undo.
// ─────────────────────────────────────────────────────────────────────────────

export type StudioTeamRow = {
  id: string;
  number: number;
  name: string;
  category: string;
  division: string;
  status: TeamStatus;
  people: {
    fullName: string;
    phone: string | null;
    email: string | null;
    dateOfBirth: string;
    studioId: string | null;
  }[];
};

export function StudioTeamsTable({
  rows,
  studios,
  open,
}: {
  rows: StudioTeamRow[];
  studios: { id: string; name: string }[];
  /** Registrations are still open — otherwise everything here is read-only. */
  open: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState("");

  function remove(row: StudioTeamRow) {
    setError("");
    startTransition(async () => {
      const result = await archiveTeam(row.id);
      if (!result.ok) {
        setError(
          result.error === "TEAM_ALREADY_SCORED"
            ? t("This team has a submitted score. Ask BFT MENA to withdraw it.")
            : result.error === "REGISTRATION_CLOSED"
              ? t("Registrations have closed. Ask BFT MENA to withdraw this team.")
              : result.error === "EVENT_RUNNING"
                ? t("The event is running — nothing can be removed from it right now.")
                : t("Something went wrong. Try again.")
        );
        return;
      }
      setConfirming(null);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div className="notice">
        <strong>{t("No teams yet.")}</strong>{" "}
        {t("Pairs appear here once they have registered and paid through the entry form.")}
      </div>
    );
  }

  return (
    <>
      {error ? (
        <div className="notice-error" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 56 }}>#</th>
              <th>{t("Team")}</th>
              <th>{t("Members")}</th>
              <th style={{ width: 170 }}>{t("Category")} · {t("Division")}</th>
              <th style={{ width: 150 }}>{t("Status")}</th>
              <th style={{ width: 170 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.id}>
                <tr>
                  <td className="pd-num muted">{row.number}</td>
                  <td>
                    <strong>{row.name}</strong>
                  </td>
                  <td>
                    {row.people.map((person) => (
                      <div key={person.fullName} className="reg-person">
                        <span>{person.fullName}</span>
                      </div>
                    ))}
                  </td>
                  <td>
                    {t(row.category)} · {t(row.division)}
                  </td>
                  <td>
                    <span className={`badge ${teamStatusTone(row.status)}`}>
                      {t(teamStatusLabel(row.status))}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={!open || pending}
                        onClick={() => setEditing((id) => (id === row.id ? null : row.id))}
                      >
                        {t("Edit")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={!open || pending}
                        onClick={() => setConfirming(row.id)}
                      >
                        {t("Remove")}
                      </button>
                    </div>
                  </td>
                </tr>

                {confirming === row.id ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="notice notice-warn">
                        <strong>
                          {t("Remove {name} from this competition?", { name: row.name })}
                        </strong>{" "}
                        {t("This cannot be undone, and their entry fee is not refunded here.")}
                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={pending}
                            onClick={() => remove(row)}
                          >
                            {pending ? <span className="spinner" /> : null}
                            {t("Yes, remove")}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={pending}
                            onClick={() => setConfirming(null)}
                          >
                            {t("Keep them")}
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}

                {editing === row.id ? (
                  <tr>
                    <td colSpan={6} className="grid-expanded">
                      <StudioTeamEditor
                        row={row}
                        studios={studios}
                        onDone={() => {
                          setEditing(null);
                          router.refresh();
                        }}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
