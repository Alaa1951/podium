"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { DetailLink } from "@/components/app/detail-link";
import { useIsMobile } from "@/components/app/use-mobile";
import { useUnsavedChanges } from "@/components/app/mobile-runtime";

import { useT } from "@/components/i18n/locale-provider";
import { renameStudio } from "@/lib/actions/account-admin";
import { addStudio, setStudioActive } from "@/lib/actions/accounts";

export type DirectoryRow = {
  id: string;
  name: string;
  isActive: boolean;
  teams: number;
  accounts: number;
  members: number;
  competitions: number;
};

/**
 * The directory itself: add a studio, or retire one.
 *
 * Retiring is not deleting. A studio that has run competitions keeps its
 * history — it simply stops being offered when the next one is set up.
 */
export function StudioDirectory({
  studios,
  detailId,
  editMode = false,
  canCreate = false,
  canEdit = false,
}: {
  studios: DirectoryRow[];
  detailId?: string;
  editMode?: boolean;
  /** studios.create — the "Add a studio" form. */
  canCreate?: boolean;
  /** studios.edit — rename, retire and reactivate. */
  canEdit?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  // The row being renamed, and what it is being renamed to.
  const [editing, setEditing] = useState<string | null>(null);
  const selected = studios.find(studio => studio.id === detailId);
  const [draft, setDraft] = useState(selected?.name ?? "");
  const mobile = useIsMobile();
  useUnsavedChanges(!!name || (editMode && draft !== selected?.name) || (!!editing && draft !== studios.find(studio => studio.id === editing)?.name));

  function add() {
    if (name.trim().length < 2) return;
    setMessage("");
    startTransition(async () => {
      const result = await addStudio({ name: name.trim() });
      if (!result.ok) {
        setMessage(
          result.error === "DUPLICATE"
            ? t("There is already a studio with that name.")
            : t("Something went wrong. Try again.")
        );
        return;
      }
      setName("");
      router.refresh();
    });
  }

  function rename(studio: DirectoryRow) {
    setMessage("");
    startTransition(async () => {
      const result = await renameStudio({ studioId: studio.id, name: draft.trim() });
      if (!result.ok) {
        setMessage(
          result.error === "DUPLICATE"
            ? t("There is already a studio with that name.")
            : t("Something went wrong. Try again.")
        );
        return;
      }
      setEditing(null);
      if (editMode) router.replace(`/studios/${studio.id}`);
      router.refresh();
    });
  }

  function toggle(studio: DirectoryRow) {
    setMessage("");
    startTransition(async () => {
      const result = await setStudioActive({ studioId: studio.id, isActive: !studio.isActive });
      if (!result.ok) { setMessage(t("Something went wrong. Try again.")); return; }
      router.refresh();
    });
  }

  if (selected) return <section className="detail-screen"><h2>{selected.name}</h2>{message ? <div role="alert" className="notice-error">{message}</div> : null}{editMode ? <form onSubmit={event => {event.preventDefault(); rename(selected);}}><label className="field-label">{t("Name")}<input className="input" value={draft} onChange={event=>setDraft(event.target.value)} required /></label><div className="mobile-action-bar"><button className="btn btn-primary" disabled={pending || draft.trim().length < 2}>{t("Save")}</button></div></form> : <><dl className="detail-facts">{[["Competitions",selected.competitions],["Teams",selected.teams],["Members",selected.members],["Accounts",selected.accounts],["Status",t(selected.isActive?"Active":"Retired")]].map(([label,value])=><div key={label}><dt>{t(String(label))}</dt><dd>{value}</dd></div>)}</dl>{canEdit ? <div className="mobile-action-bar"><Link className="btn btn-primary" href={`/studios/${selected.id}/edit`}>{t("Edit")}</Link><button className="btn btn-secondary" disabled={pending} onClick={()=>toggle(selected)}>{t(selected.isActive?"Retire":"Activate")}</button></div> : null}</>}</section>;
  return (
    <>
      {canCreate ? <section className="form-block">
        <h2 className="section-title">{t("Add a studio")}</h2>
        <div className="form-row">
          <label style={{ flex: "2 1 260px" }}>
            <span className="field-label">{t("Name")}</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="BFT West Walk"
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            onClick={add}
            disabled={pending || name.trim().length < 2}
            style={{ alignSelf: "flex-end" }}
          >
            {t("Add")}
          </button>
        </div>
      </section> : null}

      {message ? (
        <div className="notice-error" role="alert" style={{ marginBottom: 12 }}>
          {message}
        </div>
      ) : null}

      {mobile ? <div className="mobile-list">{studios.map(studio=><DetailLink key={studio.id} href={`/studios/${studio.id}`}><strong>{studio.name}</strong><span className="reg-sub">{studio.competitions} {t("Competitions")} · {studio.teams} {t("Teams")}</span><span className="badge badge-neutral">{t(studio.isActive?"Active":"Retired")}</span></DetailLink>)}</div> : <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>{t("Studio")}</th>
              <th style={{ width: 110, textAlign: "end" }}>{t("Competitions")}</th>
              <th style={{ width: 90, textAlign: "end" }}>{t("Teams")}</th>
              <th style={{ width: 100, textAlign: "end" }}>{t("Members")}</th>
              <th style={{ width: 100, textAlign: "end" }}>{t("Accounts")}</th>
              <th style={{ width: 120 }}>{t("Status")}</th>
            </tr>
          </thead>
          <tbody>
            {studios.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  {t("No studios yet.")}
                </td>
              </tr>
            ) : (
              studios.map((studio) => (
                <tr key={studio.id} style={{ opacity: studio.isActive ? 1 : 0.6 }}>
                  <td>
                    {editing === studio.id ? (
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                          className="input"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") rename(studio);
                            if (e.key === "Escape") setEditing(null);
                          }}
                          autoFocus
                          style={{ maxWidth: 240 }}
                        />
                        <button
                          type="button"
                          className="chip-sm"
                          onClick={() => rename(studio)}
                          disabled={pending || draft.trim().length < 2}
                        >
                          {t("Save")}
                        </button>
                        <button type="button" className="chip-sm" onClick={() => setEditing(null)}>
                          {t("Cancel")}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => {
                          setEditing(studio.id);
                          setDraft(studio.name);
                        }}
                        disabled={pending || !canEdit}
                      >
                        <strong>{studio.name}</strong>
                      </button>
                    )}
                  </td>
                  <td className="pd-num" style={{ textAlign: "end" }}>
                    {studio.competitions}
                  </td>
                  <td className="pd-num" style={{ textAlign: "end" }}>
                    {studio.teams}
                  </td>
                  <td className="pd-num" style={{ textAlign: "end" }}>
                    {studio.members}
                  </td>
                  <td className="pd-num" style={{ textAlign: "end" }}>
                    {studio.accounts}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="chip-sm"
                      data-active={studio.isActive || undefined}
                      disabled={pending || !canEdit}
                      onClick={() => toggle(studio)}
                    >
                      {studio.isActive ? t("Active") : t("Retired")}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>}
    </>
  );
}
