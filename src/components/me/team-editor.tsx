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
  NOT_REGISTRANT: "Only the person who registered the team can correct their partner's details.",
  OWNERSHIP_UNKNOWN: "You have both signed in, and BFT MENA has not confirmed which of you registered the team. Ask BFT MENA to confirm it — then that person can change the team.",
  PERSON_CHANGED: "A new name and a new email is a different person. To put someone else in the team, use Replace my partner — or ask BFT MENA.",
  STALE_MEMBERSHIP: "Your team changed while this page was open. Reload to see who is on it now.",
  EMAIL_IS_A_NEW_PERSON: "A different email is a different person. To change it, use Replace my partner — or ask BFT MENA.",
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
  closedReason = "window",
  version,
  closesAt,
  replaceAvailable = false,
  viewerId,
}: {
  members: EditableMember[];
  seriesId: string;
  teamId: string;
  open: boolean;
  editMode?: boolean;
  /** Why it is closed, when it is: the clock, or not this person's to change. */
  closedReason?: "window" | "registrant-only" | "not-confirmed";
  /** The team's membership version this page shows. */
  version?: number;
  /** When team changes close, already formatted in Qatar time. */
  closesAt?: string;
  /** "Replace my partner" is switched on (the way to change an email). */
  replaceAvailable?: boolean;
  /** The signed-in athlete, to label their own seat "You". */
  viewerId?: string;
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

  // Who each seat is to the person looking — never its position, which
  // says nothing about who registered or who is who.
  const seat = (member: EditableMember) => (viewerId && member.userId === viewerId ? t("You") : t("Your partner"));

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
        const result = await updateMyTeam(input, seriesId, teamId, version);
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
        {closedReason === "registrant-only"
          ? t("Only the person who registered the team can correct their partner's details.")
          : closedReason === "not-confirmed"
            ? t("You have both signed in, and BFT MENA has not confirmed which of you registered the team. Ask BFT MENA to confirm it — then that person can change the team.")
            : closesAt
              ? t("Team changes closed on {when} (Qatar time). Any change now goes through BFT MENA.", { when: closesAt })
              : t("Team changes are closed — the event starts in less than 24 hours.")}
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
          {closesAt
            ? t("You can correct your partner's name until {when} (Qatar time).", { when: closesAt })
            : t("You can correct your partner's name until 24 hours before the event.")}
        </span>
      </div>
    );
  }

  return (
    <form onInput={() => setDirty(true)} onSubmit={save} style={{ marginTop: 10, display: "grid", gap: 14, maxWidth: 560 }}>
      {members.map((member) => (
        <fieldset key={member.position} style={{ border: "1px solid var(--border)", borderRadius: "var(--r-sm)", padding: 12, display: "grid", gap: 8 }}>
          <legend className="field-label">{seat(member)}</legend>
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
              dir="ltr"
              readOnly
              defaultValue={member.email ?? ""}
            />
          </label>
          {!member.userId ? (
            <p className="field-note" style={{ margin: 0 }}>
              {replaceAvailable
                ? t("A different email is a different person: use Replace my partner.")
                : t("A different email is a different person: ask BFT MENA.")}
            </p>
          ) : null}
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
