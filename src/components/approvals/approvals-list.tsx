"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { approveSignup, rejectSignup } from "@/lib/actions/approvals";
import type { PendingSignup } from "@/lib/approvals";

// ─────────────────────────────────────────────────────────────────────────────
// REQUESTS WAITING FOR APPROVAL.
//
// One card per sign-up: who they are, what they asked for, and — for an
// athlete — their level, category and partner. The approver picks the roles
// (the requested one is ticked already) and, at BFT MENA, the studio. The
// server re-checks every choice; the offered roles are only the ones this
// approver may give.
// ─────────────────────────────────────────────────────────────────────────────

export type ApprovalRoleOption = { id: string; key: string; name: string; accountTypes: string[] };

const ERRORS: Record<string, string> = {
  ALREADY_DECIDED: "Someone else already decided this request.",
  NOT_FOUND: "That request is no longer waiting.",
  FORBIDDEN: "You are not allowed to do that.",
  ROLE_NOT_ASSIGNABLE: "You cannot give that role.",
  ROLE_NOT_FOR_ACCOUNT_TYPE: "That role is not meant for this kind of account.",
  NOT_HELD: "You cannot give a role with permissions you do not hold.",
  STUDIO_REQUIRED: "Pick the studio, or type the name of a new one.",
  STUDIO_NAME_TAKEN: "A studio with that name already exists — pick it from the list.",
  STUDIO_NOT_FOUND: "That studio no longer exists.",
  CANNOT_CHANGE_OWN_ACCESS: "You cannot decide your own request.",
};

const REQUEST_LABEL: Record<string, string> = {
  athlete: "Athlete",
  organiser: "Organiser",
  judge: "Judge",
  volunteer: "Volunteer",
  coach: "Coach",
  "gym-studio": "Gym/Studio",
};

/** The account type the request becomes, for filtering the offered roles. */
const accountTypeFor = (request: PendingSignup) =>
  request.requestedRoleKey === "gym-studio" ? "studio" : request.signupType === "athlete" ? "competitor" : "organiser";

function RequestCard({
  request,
  roles,
  studios,
  canPickStudio,
}: {
  request: PendingSignup;
  roles: ApprovalRoleOption[];
  studios: { id: string; name: string }[];
  canPickStudio: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const gym = request.requestedRoleKey === "gym-studio";
  const type = accountTypeFor(request);
  const offered = roles.filter((role) => role.accountTypes.length === 0 || role.accountTypes.includes(type));
  const [picked, setPicked] = useState<string[]>(() =>
    offered.filter((role) => role.key === request.requestedRoleKey).map((role) => role.id)
  );
  const [studioId, setStudioId] = useState(request.requestedStudioId ?? "");
  const [newStudio, setNewStudio] = useState(request.requestedStudioName ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

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

  const approve = () =>
    run(() =>
      approveSignup({
        userId: request.id,
        roleIds: picked,
        ...(canPickStudio ? { studioId: studioId || null } : {}),
        ...(canPickStudio && gym && !studioId && newStudio.trim() ? { newStudioName: newStudio.trim() } : {}),
      })
    );

  const athlete = request.athlete;
  return (
    <section className="card approval-card">
      <div className="approval-head">
        <div>
          <h3 style={{ margin: 0 }}>{request.name ?? request.email}</h3>
          <p className="reg-sub" style={{ margin: "4px 0 0" }}>
            {request.email}
            {request.phone ? ` · ${request.phone}` : ""}
          </p>
        </div>
        <span className="badge badge-cyan">{t(REQUEST_LABEL[request.requestedRoleKey ?? ""] ?? "Organiser")}</span>
      </div>

      <dl className="approval-facts">
        {request.requestedStudioLabel ? (
          <>
            <dt>{t("Gym/Studio")}</dt>
            <dd>{request.requestedStudioLabel}</dd>
          </>
        ) : null}
        {/* Which competition they asked for. Shown because approving them may
            ENTER them in it (enter-pair.ts) — the approver should not have to
            find that out afterwards. */}
        {request.requestedSeriesName ? (
          <>
            <dt>{t("Competition")}</dt>
            <dd>{request.requestedSeriesName}</dd>
          </>
        ) : null}
        {gym ? (
          <>
            <dt>{t("New gym")}</dt>
            <dd>
              {request.requestedStudioName ?? "—"}
              {request.requestedCity ? ` · ${request.requestedCity}` : ""}
            </dd>
          </>
        ) : null}
        {athlete ? (
          <>
            <dt>{t("Level")}</dt>
            <dd>
              {t(athlete.division ?? "—")} · {t(athlete.category ?? "—")}
            </dd>
            <dt>{t("Date of birth")}</dt>
            <dd>{athlete.dateOfBirth ?? "—"}</dd>
            <dt>{t("Partner")}</dt>
            <dd>
              {athlete.lookingForPartner
                ? t("Looking for a partner")
                : `${athlete.partnerName ?? "—"}${athlete.partnerEmail ? ` · ${athlete.partnerEmail}` : ""}${
                    athlete.partnerLinked ? ` · ${t("linked")}` : ""
                  }`}
            </dd>
          </>
        ) : null}
        {request.signupAt ? (
          <>
            <dt>{t("Signed up")}</dt>
            <dd>{request.signupAt}</dd>
          </>
        ) : null}
      </dl>

      {canPickStudio ? (
        <div className="form-row" style={{ alignItems: "flex-end" }}>
          <label style={{ flex: "1 1 200px" }}>
            <span className="field-label">{t("Studio")}</span>
            <select className="input" value={studioId} disabled={pending} onChange={(e) => setStudioId(e.target.value)}>
              <option value="">{gym ? t("A new studio…") : t("No studio")}</option>
              {studios.map((studio) => (
                <option key={studio.id} value={studio.id}>
                  {studio.name}
                </option>
              ))}
            </select>
          </label>
          {gym && !studioId ? (
            <label style={{ flex: "1 1 200px" }}>
              <span className="field-label">{t("New studio name")}</span>
              <input className="input" value={newStudio} maxLength={120} disabled={pending} onChange={(e) => setNewStudio(e.target.value)} />
            </label>
          ) : null}
        </div>
      ) : null}

      <div style={{ marginTop: 10 }}>
        <span className="field-label">{t("Roles to give")}</span>
        <div className="role-chips">
          {offered.map((role) => {
            const on = picked.includes(role.id);
            return (
              <button
                key={role.id}
                type="button"
                className="chip-sm"
                data-active={on ? "" : undefined}
                aria-pressed={on}
                disabled={pending}
                onClick={() => setPicked((current) => (on ? current.filter((id) => id !== role.id) : [...current, role.id]))}
              >
                {on ? "✓ " : ""}
                {t(role.name)}
              </button>
            );
          })}
          {offered.length === 0 ? <span className="reg-sub">{t("No role you can give fits this request.")}</span> : null}
        </div>
      </div>

      {error ? (
        <div className="notice-error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : null}

      {rejecting ? (
        <div className="form-row" style={{ alignItems: "flex-end", marginTop: 10 }}>
          <label style={{ flex: "3 1 240px" }}>
            <span className="field-label">{t("Reason (sent to them)")}</span>
            <input className="input" value={reason} maxLength={500} disabled={pending} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="button" className="btn btn-danger" disabled={pending} onClick={() => run(() => rejectSignup({ userId: request.id, reason }))}>
            {t("Turn down")}
          </button>
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setRejecting(false)}>
            {t("Cancel")}
          </button>
        </div>
      ) : (
        <div className="approval-actions">
          <button type="button" className="btn btn-primary" disabled={pending} onClick={approve}>
            {t("Approve")}
          </button>
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setRejecting(true)}>
            {t("Turn down…")}
          </button>
        </div>
      )}
    </section>
  );
}

export function ApprovalsList({
  requests,
  roles,
  studios,
  canPickStudio,
  canDecide,
}: {
  requests: PendingSignup[];
  roles: ApprovalRoleOption[];
  studios: { id: string; name: string }[];
  /** BFT MENA: choose or create the studio. A studio approves into itself. */
  canPickStudio: boolean;
  canDecide: boolean;
}) {
  const t = useT();
  if (requests.length === 0) return <p className="reg-sub">{t("No requests are waiting.")}</p>;
  if (!canDecide) {
    return (
      <ul className="approval-readonly">
        {requests.map((request) => (
          <li key={request.id}>
            {request.name ?? request.email} · {t(REQUEST_LABEL[request.requestedRoleKey ?? ""] ?? "Organiser")}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="approval-list">
      {requests.map((request) => (
        <RequestCard key={request.id} request={request} roles={roles} studios={studios} canPickStudio={canPickStudio} />
      ))}
    </div>
  );
}
