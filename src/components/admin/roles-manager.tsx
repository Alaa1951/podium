"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DetailLink } from "@/components/app/detail-link";
import { useUnsavedChanges } from "@/components/app/mobile-runtime";
import { useIsMobile } from "@/components/app/use-mobile";
import { useLocale } from "@/components/i18n/locale-provider";
import { coverageLabel, PermissionTree, type TreeModule } from "@/components/permissions/permission-tree";
import { createAccessRole, deleteAccessRole, updateAccessRole } from "@/lib/actions/roles";
import type { PermissionPolicy } from "@/lib/permissions/catalog";

// ─────────────────────────────────────────────────────────────────────────────
// THE ROLES SCREEN.
//
// One card per role. Opening a card shows its details (who may hand it out,
// who it is meant for) and the full permission tree: Module → Screen → action,
// one tick per action, with Block / Partial / Full per screen. A row the viewer
// may not change is not a mysterious grey box — it carries the reason:
// "Always on", "BFT MENA Full access only", "Studios can give this role — no
// BFT-only permissions", or "You don't hold this". The server applies exactly
// the same rules (grant-policy.ts) and keeps what this editor could not touch.
// ─────────────────────────────────────────────────────────────────────────────

export type RoleDTO = {
  id: string;
  key: string;
  name: string;
  nameAr: string | null;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  assignableBy: "bft" | "bft_studio";
  accountTypes: string[];
  usersCount: number;
  loadedAt: string;
};

export type RoleTreeRow = {
  key: string;
  label: string;
  labelAr: string;
  policy: PermissionPolicy;
  /** Whether the viewer holds this permission themselves. */
  held: boolean;
};

export type RoleTreeModule = TreeModule<RoleTreeRow>;

type Draft = {
  name: string;
  nameAr: string;
  description: string;
  assignableBy: "bft" | "bft_studio";
  accountTypes: string[];
  permissions: string[];
};

const ACCOUNT_TYPES: { value: string; label: string }[] = [
  { value: "staff", label: "BFT MENA Partial" },
  { value: "studio", label: "Gym / Studio" },
  { value: "organiser", label: "Organiser" },
  { value: "competitor", label: "Athlete" },
];

const ERRORS: Record<string, string> = {
  KEY_TAKEN: "A role with that name already exists.",
  SYSTEM_ROLE: "Roles Podium ships with cannot be deleted. Edit them instead.",
  ROLE_IN_USE: "People still hold this role. Take it away from them first.",
  STALE: "Someone else changed this role while you were editing. Reload to see their changes.",
  NOT_HELD: "You can only give permissions you hold yourself.",
  BFT_ONLY_IN_STUDIO_ROLE: "A role studios can give cannot carry BFT MENA-only permissions.",
  NOT_STORABLE: "That permission cannot be put in a role.",
  FORBIDDEN: "You are not allowed to do that.",
};

type LockReason = "ALWAYS_ON" | "FULL_ADMIN_ONLY" | "BFT_ONLY_ROLE" | "NOT_HELD";

const LOCK_TEXT: Record<LockReason, string> = {
  ALWAYS_ON: "Always on for everyone",
  FULL_ADMIN_ONLY: "BFT MENA Full access only",
  BFT_ONLY_ROLE: "Not in a role studios can give",
  NOT_HELD: "You don't hold this",
};

/** Mirrors grant-policy.roleRowLock — the server re-checks every row. */
function rowLock(row: RoleTreeRow, assignableBy: Draft["assignableBy"]): LockReason | null {
  if (row.policy === "general") return "ALWAYS_ON";
  if (row.policy === "fullAdminOnly") return "FULL_ADMIN_ONLY";
  if (row.policy === "bftOnly" && assignableBy === "bft_studio") return "BFT_ONLY_ROLE";
  if (!row.held) return "NOT_HELD";
  return null;
}

function draftOf(role: RoleDTO): Draft {
  return {
    name: role.name,
    nameAr: role.nameAr ?? "",
    description: role.description ?? "",
    assignableBy: role.assignableBy,
    accountTypes: [...role.accountTypes],
    permissions: [...role.permissions].sort(),
  };
}

export function RolesManager({
  roles,
  tree,
  canEdit,
  detailId,
  editMode = false,
}: {
  roles: RoleDTO[];
  tree: RoleTreeModule[];
  canEdit: boolean;
  detailId?: string;
  editMode?: boolean;
}) {
  const { t, locale } = useLocale();
  const ar = locale === "ar";
  const router = useRouter();
  const mobile = useIsMobile();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [openId, setOpenId] = useState<string | null>(editMode ? detailId ?? null : null);
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const isDirty = (role: RoleDTO) =>
    !!drafts[role.id] && JSON.stringify(drafts[role.id]) !== JSON.stringify(draftOf(role));
  useUnsavedChanges(!!newName || roles.some(isDirty));

  const draftFor = (role: RoleDTO) => drafts[role.id] ?? draftOf(role);
  const setDraft = (role: RoleDTO, next: Draft) =>
    setDrafts((current) => ({ ...current, [role.id]: next }));

  function fail(result: { error: string; keys?: string[] }) {
    setMessage("");
    const base = t(ERRORS[result.error] ?? "Something went wrong. Try again.");
    setError(result.keys?.length ? `${base} (${result.keys.join(", ")})` : base);
  }

  function create() {
    const name = newName.trim();
    if (name.length < 2) return;
    setError("");
    startTransition(async () => {
      const result = await createAccessRole({ name, permissions: [] });
      if (!result.ok) return fail(result);
      setNewName("");
      setMessage(t("Role created."));
      router.refresh();
    });
  }

  function save(role: RoleDTO) {
    const draft = draftFor(role);
    setError("");
    startTransition(async () => {
      try {
        const result = await updateAccessRole({
          roleId: role.id,
          loadedAt: role.loadedAt,
          name: draft.name,
          nameAr: draft.nameAr || undefined,
          description: draft.description || undefined,
          assignableBy: draft.assignableBy,
          accountTypes: draft.accountTypes,
          permissions: draft.permissions,
        });
        if (!result.ok) return fail(result);
        setDrafts((current) => {
          const next = { ...current };
          delete next[role.id];
          return next;
        });
        setMessage(t("Role saved."));
        router.refresh();
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      }
    });
  }

  function remove(role: RoleDTO) {
    if (!window.confirm(t("Delete the role {name}?", { name: role.name }))) return;
    setError("");
    startTransition(async () => {
      const result = await deleteAccessRole({ roleId: role.id });
      if (!result.ok) return fail(result);
      setMessage(t("Role deleted."));
      if (detailId) router.replace("/roles");
      router.refresh();
    });
  }

  const roleName = (role: RoleDTO) => (ar && role.nameAr ? role.nameAr : role.name);
  const shown = roles.filter((role) => !detailId || role.id === detailId);

  return (
    <>
      {message ? (
        <div className="notice" role="status" style={{ marginBottom: 14 }}>
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="notice-error" role="alert" style={{ marginBottom: 14 }}>
          {error}
        </div>
      ) : null}

      {canEdit && !detailId ? (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="form-row" style={{ alignItems: "flex-end", marginTop: 0 }}>
            <Field label={t("New role name")}>
              <input
                className="input"
                value={newName}
                maxLength={60}
                placeholder={t("Head judge")}
                onChange={(e) => setNewName(e.target.value)}
              />
            </Field>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending || newName.trim().length < 2}
              onClick={create}
              style={{ height: 38 }}
            >
              {pending ? <span className="spinner" /> : null}
              {t("Add role")}
            </button>
          </div>
        </div>
      ) : null}

      {shown.map((role) => {
        if (mobile && !detailId) {
          return (
            <DetailLink key={role.id} href={`/roles/${role.id}`}>
              <strong>{roleName(role)}</strong>
              <span>
                {role.permissions.length} {t("permissions")} · {role.usersCount} {t("people")}
              </span>
            </DetailLink>
          );
        }

        const draft = draftFor(role);
        const open = openId === role.id || (!!detailId && editMode);
        const dirty = isDirty(role);
        const editable = canEdit && (!detailId || editMode);

        function toggle(key: string, on: boolean) {
          const set = new Set(draft.permissions);
          if (on) set.add(key);
          else set.delete(key);
          setDraft(role, { ...draft, permissions: [...set].sort() });
        }
        function setScreen(keys: string[], on: boolean) {
          const set = new Set(draft.permissions);
          for (const key of keys) {
            if (on) set.add(key);
            else set.delete(key);
          }
          setDraft(role, { ...draft, permissions: [...set].sort() });
        }

        return (
          <div key={role.id} className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {detailId ? (
                <h2 style={{ margin: 0 }}>{roleName(role)}</h2>
              ) : (
                <button
                  type="button"
                  className="linkish"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : role.id)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                >
                  <span style={{ fontSize: 12 }}>{open ? "▾" : "▸"}</span>
                  <strong>{draft.name || role.name}</strong>
                </button>
              )}
              <span className="reg-sub pd-num">
                {draft.permissions.length} {t("permissions")} · {role.usersCount} {t("people")}
              </span>
              {role.isSystem ? <span className="badge badge-neutral">{t("Ships with Podium")}</span> : null}
              {role.assignableBy === "bft_studio" ? (
                <span className="badge badge-cyan">{t("Studios can give this")}</span>
              ) : null}
              {editable && !role.isSystem ? (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  style={{ marginInlineStart: "auto", color: "var(--status-danger-text)" }}
                  disabled={pending || role.usersCount > 0}
                  title={role.usersCount > 0 ? t(ERRORS.ROLE_IN_USE) : undefined}
                  onClick={() => remove(role)}
                >
                  {t("Delete role")}
                </button>
              ) : null}
            </div>
            {role.description && !open ? (
              <p className="reg-sub" style={{ margin: "6px 0 0" }}>
                {role.description}
              </p>
            ) : null}

            {detailId && !editMode ? (
              <>
                {canEdit ? (
                  <Link href={`/roles/${role.id}/edit`} className="btn btn-primary" style={{ marginTop: 12 }}>
                    {t("Edit")}
                  </Link>
                ) : null}
                <PermissionTree
                  modules={tree
                    .map((module) => ({
                      ...module,
                      screens: module.screens.map((screen) => ({
                        ...screen,
                        rows: screen.rows.filter((row) => role.permissions.includes(row.key)),
                      })),
                    }))}
                  renderRow={(row) => (
                    <div className="perm-row" data-effective="true">
                      <span className="perm-row-label">
                        <span className="perm-dot" />
                        {ar ? row.labelAr : t(row.label)}
                      </span>
                    </div>
                  )}
                />
              </>
            ) : null}

            {open && (!detailId || editMode) ? (
              <div style={{ marginTop: 14 }}>
                <div className="form-row" style={{ alignItems: "flex-end" }}>
                  <Field label={t("Role name (English)")}>
                    <input
                      className="input"
                      value={draft.name}
                      disabled={!editable}
                      onChange={(e) => setDraft(role, { ...draft, name: e.target.value })}
                    />
                  </Field>
                  <Field label={t("Role name (Arabic)")}>
                    <input
                      className="input"
                      dir="rtl"
                      value={draft.nameAr}
                      disabled={!editable}
                      onChange={(e) => setDraft(role, { ...draft, nameAr: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="form-row">
                  <Field label={t("What this role is for")}>
                    <input
                      className="input"
                      value={draft.description}
                      maxLength={200}
                      disabled={!editable}
                      onChange={(e) => setDraft(role, { ...draft, description: e.target.value })}
                    />
                  </Field>
                  <Field label={t("Who can give this role")}>
                    <select
                      className="input"
                      value={draft.assignableBy}
                      disabled={!editable}
                      onChange={(e) => {
                        const assignableBy = e.target.value as Draft["assignableBy"];
                        // Studios can hand this role out: BFT-only rows leave it.
                        const permissions =
                          assignableBy === "bft_studio"
                            ? draft.permissions.filter(
                                (key) =>
                                  !tree.some((m) =>
                                    m.screens.some((s) =>
                                      s.rows.some((r) => r.key === key && r.policy === "bftOnly")
                                    )
                                  )
                              )
                            : draft.permissions;
                        setDraft(role, { ...draft, assignableBy, permissions });
                      }}
                    >
                      <option value="bft">{t("BFT MENA only")}</option>
                      <option value="bft_studio">{t("BFT MENA and studios")}</option>
                    </select>
                  </Field>
                </div>
                <fieldset className="form-row" style={{ border: 0, padding: 0, margin: "10px 0 0", gap: 14 }}>
                  <legend className="field-label">{t("Meant for")}</legend>
                  {ACCOUNT_TYPES.map((type) => (
                    <label key={type.value} className="checkline">
                      <input
                        type="checkbox"
                        disabled={!editable}
                        checked={draft.accountTypes.includes(type.value)}
                        onChange={(e) =>
                          setDraft(role, {
                            ...draft,
                            accountTypes: e.target.checked
                              ? [...draft.accountTypes, type.value]
                              : draft.accountTypes.filter((value) => value !== type.value),
                          })
                        }
                      />
                      <span>{t(type.label)}</span>
                    </label>
                  ))}
                </fieldset>

                <div className="form-row" style={{ alignItems: "flex-end" }}>
                  <label style={{ flex: "1 1 240px" }}>
                    <span className="field-label">{t("Search permissions")}</span>
                    <input
                      className="input"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t("Score, waves, users…")}
                    />
                  </label>
                  {editable ? (
                    <button
                      type="button"
                      className="btn btn-primary desktop-only"
                      disabled={pending || !dirty}
                      onClick={() => save(role)}
                    >
                      {pending ? <span className="spinner" /> : null}
                      {t("Save role")}
                    </button>
                  ) : null}
                </div>

                <PermissionTree
                  modules={tree}
                  search={search}
                  moduleSummary={(module) => {
                    const rows = module.screens.flatMap((screen) => screen.rows).filter((row) => row.policy !== "general");
                    return coverageLabel(rows.filter((row) => draft.permissions.includes(row.key)).length, rows.length, t);
                  }}
                  screenSummary={(screen) => {
                    const rows = screen.rows.filter((row) => row.policy !== "general");
                    if (!rows.length) return t("Always on for everyone");
                    return coverageLabel(rows.filter((row) => draft.permissions.includes(row.key)).length, rows.length, t);
                  }}
                  screenActions={(screen) => {
                    const keys = screen.rows
                      .filter((row) => rowLock(row, draft.assignableBy) === null)
                      .map((row) => row.key);
                    if (!editable || !keys.length) return null;
                    return (
                      <>
                        <button type="button" className="chip-sm" disabled={pending} onClick={() => setScreen(keys, true)}>
                          {t("Full")}
                        </button>
                        <button type="button" className="chip-sm" disabled={pending} onClick={() => setScreen(keys, false)}>
                          {t("Block")}
                        </button>
                      </>
                    );
                  }}
                  renderRow={(row) => {
                    const lock = rowLock(row, draft.assignableBy);
                    const on = row.policy === "general" || draft.permissions.includes(row.key);
                    return (
                      <label className="perm-row" data-effective={on}>
                        <span className="perm-row-label">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!editable || pending || lock !== null}
                            onChange={(e) => toggle(row.key, e.target.checked)}
                          />
                          <span>{ar ? row.labelAr : t(row.label)}</span>
                          <span className="perm-row-key">{row.key}</span>
                        </span>
                        {lock ? <span className="perm-lock">{t(LOCK_TEXT[lock])}</span> : null}
                      </label>
                    );
                  }}
                />

                {editable ? (
                  <div className="mobile-action-bar mobile-only">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={pending || !dirty}
                      onClick={() => save(role)}
                    >
                      {pending ? <span className="spinner" /> : null}
                      {t("Save role")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", flex: "1 1 220px", minWidth: 0 }}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
