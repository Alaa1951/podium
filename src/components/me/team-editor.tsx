"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { updateMyTeam, type MyTeamMemberInput } from "@/lib/actions/my-team";

export type EditableMember = {
  position: number;
  fullName: string;
  email: string | null;
};

const ERRORS: Record<string, string> = {
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
  open,
}: {
  members: EditableMember[];
  open: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
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
      const result = await updateMyTeam(input);
      if (!result.ok) {
        setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
        return;
      }
      setSaved(true);
      setEditing(false);
      router.refresh();
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
        <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
          {t("Edit team")}
        </button>
        <span className="field-note" style={{ marginTop: 0 }}>
          {t("Names and emails can be changed until 24 hours before the event.")}
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={save} style={{ marginTop: 10, display: "grid", gap: 14, maxWidth: 560 }}>
      {members.map((member) => (
        <fieldset key={member.position} style={{ border: "1px solid var(--border)", borderRadius: "var(--r-sm)", padding: 12, display: "grid", gap: 8 }}>
          <legend className="field-label">{seat(member.position)}</legend>
          <label className="field-label" htmlFor={`name-${member.position}`}>
            {t("Name")}
            <input
              id={`name-${member.position}`}
              name={`name-${member.position}`}
              className="input"
              defaultValue={member.fullName}
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

      <div style={{ display: "flex", gap: 10 }}>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? <span className="spinner" /> : null}
          {t("Save changes")}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)} disabled={pending}>
          {t("Close")}
        </button>
      </div>
    </form>
  );
}
