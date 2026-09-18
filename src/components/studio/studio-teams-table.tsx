"use client";

import { useRouter, usePathname } from "next/navigation";
import { Fragment, useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { StudioTeamEditor } from "@/components/studio/studio-team-editor";
import { archiveTeam } from "@/lib/actions/team-people";
import { teamStatusLabel, teamStatusTone, type TeamStatus } from "@/lib/team-status";
import { DetailLink } from "@/components/app/detail-link";
import { useIsMobile } from "@/components/app/use-mobile";

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
    id?: string;
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
  detailId,
  editMode = false,
}: {
  rows: StudioTeamRow[];
  studios: { id: string; name: string }[];
  /** Registrations are still open — otherwise everything here is read-only. */
  open: boolean;
  detailId?: string;
  editMode?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const mobile = useIsMobile();
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
      if (detailId) router.replace(path.replace(/\/[^/]+$/, ""));
      else router.refresh();
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

  if (detailId) {
    const row = rows.find((row) => row.id === detailId)!;
    if (editMode && open) return <div className="mobile-detail"><h1>{row.name}</h1><StudioTeamEditor row={row} studios={studios} onDone={() => { router.replace(path.replace(/\/edit$/, "")); router.refresh(); }} /></div>;
    return <article className="mobile-detail"><h1>{row.name}</h1><span className={`badge ${teamStatusTone(row.status)}`}>{t(teamStatusLabel(row.status))}</span><p>{t(row.category)} · {t(row.division)}</p>{row.people.map((person,index) => <div key={person.id ?? index} className="mobile-list-card"><div>{person.id ? <DetailLink href={`${path}/people/${person.id}`} className="linkish"><strong>{person.fullName}</strong></DetailLink> : <strong>{person.fullName}</strong>}<small>{person.email ?? "—"}</small><small dir="ltr">{person.phone ?? "—"}</small></div></div>)}{error ? <p className="notice-error" role="alert">{error}</p> : null}{confirming === row.id ? <div className="notice notice-warn"><p>{t("Remove {name} from this competition?",{name:row.name})}</p><button className="btn btn-danger" disabled={pending} onClick={() => remove(row)}>{t("Yes, remove")}</button><button className="btn btn-secondary" onClick={() => setConfirming(null)}>{t("Keep them")}</button></div> : null}<div className="mobile-action-bar">{open ? <DetailLink href={`${path}/edit`} className="btn btn-primary">{t("Edit")}</DetailLink> : null}<button className="btn btn-ghost" disabled={!open || pending} onClick={() => setConfirming(row.id)}>{t("Remove")}</button></div></article>;
  }

  if (mobile) return <div className="mobile-list">{rows.map((row) => <DetailLink key={row.id} href={`${path}/${row.id}`}><span className="pd-num">#{row.number}</span><div><strong>{row.name}</strong><small>{row.people.map((person) => person.fullName).join(" · ")}</small><small>{t(row.category)} · {t(row.division)}</small></div><span className={`badge ${teamStatusTone(row.status)}`}>{t(teamStatusLabel(row.status))}</span><span aria-hidden="true">›</span></DetailLink>)}</div>;

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
