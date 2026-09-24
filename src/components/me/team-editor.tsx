"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useIsMobile } from "@/components/app/use-mobile";
import { confirmUnsaved, useUnsavedChanges } from "@/components/app/mobile-runtime";

import { useT } from "@/components/i18n/locale-provider";
import { updateMyTeam, type MyTeamMemberInput } from "@/lib/actions/my-team";

export type EditableMember = {
  userId?: string | null;
  position: number;
  fullName: string;
  email: string | null;
};

const ERRORS: Record<string, string> = {
  SHARED_PROFILE: "Edit personal details from your account; team changes do not change shared identities.",
  ALREADY_ENTERED: "This athlete is already entered in this competition.",
  FORBIDDEN: "You are not allowed to do that.",
  TEAM_EDIT_CLOSED: "Team changes are closed — the event starts in less than 24 hours.",
  NAME_REQUIRED: "Give every member a name.",
  EMAIL_INVALID: "That email does not look right.",
};

/**
 * The member's own team correction: either seat's name and email, open until
 * the event is 24 hours away. Whether the door is open was decided on the
 * server and handed in here — this only draws it honestly.
 */
export function TeamEditor({
  members,
  seriesId,
  teamId,
  open,
  editMode = false,
}: {
  members: EditableMember[];
  seriesId: string;
  teamId: string;
  open: boolean;
  editMode?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(editMode);
  const mobile = useIsMobile();
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(editing && dirty);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const seat = (position: number) =>
    t(position === 1 ? "First member" : "Partner");

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setError("");
    setSaved(false);
    const input: MyTeamMemberInput[] = members.map((member) => ({
      position: member.position,
      fullName: String(data.get(`name-${member.position}`) || ""),
      email: String(data.get(`email-${member.position}`) || ""),
    }));

    startTransition(async () => {
      try {
        const result = await updateMyTeam(input, seriesId, teamId);
        if (!result.ok) {
          setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
          return;
        }
        setSaved(true);
        setDirty(false);
        setEditing(false);
        if (editMode) router.replace(`/me?series=${encodeURIComponent(seriesId)}`);
        router.refresh();
      } catch { setError(t("Could not save. Check your connection and try again.")); }
    });
  }

  if (!open) {
    return (
      <p className="field-note" style={{ marginTop: 8 }}>
        {t("Team changes are closed — the event starts in less than 24 hours.")}
      </p>
    );
  }

  if (!editing) {
    return (
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        {mobile ? <Link href={`/me/edit?series=${encodeURIComponent(seriesId)}`} className="btn btn-secondary">{t("Edit team")}</Link> : <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
          {t("Edit team")}
        </button>}
        <span className="field-note" style={{ marginTop: 0 }}>
          {t("Names and emails can be changed until 24 hours before the event.")}
        </span>
      </div>
    );
  }

  return (
    <form onInput={() => setDirty(true)} onSubmit={save} style={{ marginTop: 10, display: "grid", gap: 14, maxWidth: 560 }}>
      {members.map((member) => (
        <fieldset key={member.position} style={{ border: "1px solid var(--border)", borderRadius: "var(--r-sm)", padding: 12, display: "grid", gap: 8 }}>
          <legend className="field-label">{seat(member.position)}</legend>
          {member.userId && <p className="field-note">{t("Edit personal details from your account; team changes do not change shared identities.")} <Link href="/me?series=all">{t("Personal details")}</Link></p>}
          <label className="field-label" htmlFor={`name-${member.position}`}>
            {t("Name")}
            <input
              id={`name-${member.position}`}
              name={`name-${member.position}`}
              className="input"
              defaultValue={member.fullName}
              readOnly={Boolean(member.userId)}
              required
            />
          </label>
          <label className="field-label" htmlFor={`email-${member.position}`}>
            {t("Email")}
            <input
              id={`email-${member.position}`}
              name={`email-${member.position}`}
              className="input"
              type="email"
              readOnly={Boolean(member.userId)}
              defaultValue={member.email ?? ""}
            />
          </label>
        </fieldset>
      ))}

      {error ? (
        <div className="notice-error" role="alert">
          {error}
        </div>
      ) : null}
      {saved ? <div className="notice">{t("Team updated.")}</div> : null}

      <div className="mobile-action-bar" style={{ display: "flex", gap: 10 }}>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? <span className="spinner" /> : null}
          {t("Save changes")}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => {if (!confirmUnsaved(t("You have unsaved changes. Leave this screen?"))) return; setDirty(false); setEditing(false); if(editMode) router.replace(`/me?series=${encodeURIComponent(seriesId)}`);}} disabled={pending}>
          {t("Close")}
        </button>
      </div>
    </form>
  );
}
