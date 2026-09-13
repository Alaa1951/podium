"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { createAccessRole, deleteAccessRole, updateAccessRole } from "@/lib/actions/roles";
import { PERMISSION_GROUPS } from "@/lib/access";

// ─────────────────────────────────────────────────────────────────────────────
// THE ROLES MATRIX.
//
// One card per role. Each card carries the full permission catalog, grouped by
// the part of the system it belongs to, with a search to cut through it. A
// group is Block (no keys), Partial (some keys — tick them in the group) or
// Full (every key); the state is derived from what is ticked, so it can never
// disagree with what is actually granted.
// ─────────────────────────────────────────────────────────────────────────────

export type RoleDTO = {
  id: string;
  key: string;
  name: string;
  nameAr: string | null;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  usersCount: number;
};

type Draft = { name: string; nameAr: string; permissions: string[] };

function draftOf(role: RoleDTO): Draft {
  return { name: role.name, nameAr: role.nameAr ?? "", permissions: [...role.permissions] };
}

function groupState(keys: string[], permissions: string[]) {
  const have = keys.filter((key) => permissions.includes(key)).length;
  if (have === 0) return "block" as const;
  if (have === keys.length) return "full" as const;
  return "partial" as const;
}

export function RolesManager({ roles }: { roles: RoleDTO[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [newName, setNewName] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  function draftFor(role: RoleDTO): Draft {
    return drafts[role.id] ?? draftOf(role);
  }
  function setDraft(role: RoleDTO, next: Draft) {
    setDrafts((current) => ({ ...current, [role.id]: next }));
  }

  function report(result: { ok: boolean; error?: string; message?: string }) {
    if (result.ok) {
      setMessage(result.message ?? "");
      router.refresh();
      return;
    }
    setMessage(
      result.error === "KEY_TAKEN"
        ? t("A role with that name already exists.")
        : result.error === "SYSTEM_ROLE"
          ? t("System roles cannot be deleted.")
          : t("Something went wrong. Try again.")
    );
  }

  function create() {
    const name = newName.trim();
    if (!name) return;
    setMessage("");
    startTransition(async () => {
      const result = await createAccessRole({ name, permissions: [] });
      if (result.ok) {
        setNewName("");
        router.refresh();
      }
      report(result);
    });
  }

  function save(role: RoleDTO) {
    const draft = draftFor(role);
    setMessage("");
    startTransition(async () => {
      const result = await updateAccessRole({
        roleId: role.id,
        name: draft.name,
        nameAr: draft.nameAr || undefined,
        permissions: draft.permissions,
      });
      if (result.ok) {
        setMessage(result.message ?? "");
        router.refresh();
      } else {
        report(result);
      }
    });
  }

  function remove(role: RoleDTO) {
    setMessage("");
    startTransition(async () => {
      const result = await deleteAccessRole({ roleId: role.id });
      if (result.ok) {
        setMessage(result.message ?? "");
        router.refresh();
      } else {
        report(result);
      }
    });
  }

  return (
    <>
      {message ? (
        <div className="notice" role="status" style={{ marginBottom: 14 }}>
          {message}
        </div>
      ) : null}

      {/* ── Create ─────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="form-row" style={{ alignItems: "flex-end", marginTop: 0 }}>
          <Field label={t("New role name")}>
            <input
              className="input"
              value={newName}
              maxLength={60}
              placeholder={t("Wave scorer")}
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

      {roles.length === 0 ? (
        <div className="notice">
          <strong>{t("No roles yet.")}</strong>{" "}
          {t(
            "Create one, tick what it may open and change, then assign it from the Users screen."
          )}
        </div>
      ) : null}

      {roles.map((role) => {
        const draft = draftFor(role);
        const search = (searches[role.id] ?? "").toLowerCase();
        const open = openId === role.id;
        const dirty =
          JSON.stringify([...draft.permissions].sort()) !==
          JSON.stringify([...role.permissions].sort());

        return (
          <div key={role.id} className="card" style={{ marginBottom: 14 }}>
            {/* Role header: open/close, name, count, delete. */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="linkish"
                aria-expanded={open}
                onClick={() => {
                  setOpenId(open ? null : role.id);
                  setSearches((current) => ({ ...current, [role.id]: "" }));
                }}
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                <span style={{ fontSize: 12 }}>{open ? "▾" : "▸"}</span>
                <strong>{draft.name || role.name}</strong>
              </button>
              <span className="reg-sub pd-num">
                {draft.permissions.length} {t("permissions")}
                {role.usersCount ? ` · ${role.usersCount} ${t("accounts")}` : ""}
              </span>
              {!role.isSystem ? (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost push"
                  disabled={pending}
                  onClick={() => remove(role)}
                  style={{ color: "var(--status-danger-text)" }}
                >
                  {t("Delete role")}
                </button>
              ) : (
                <span className="badge badge-neutral push">{t("System role")}</span>
              )}
            </div>

            {open ? (
              <div style={{ marginTop: 14 }}>
                <div className="form-row" style={{ alignItems: "flex-end" }}>
                  <Field label={t("Role name (English)")}>
                    <input
                      className="input"
                      value={draft.name}
                      onChange={(e) => setDraft(role, { ...draft, name: e.target.value })}
                    />
                  </Field>
                  <Field label={t("Role name (Arabic)")}>
                    <input
                      className="input"
                      value={draft.nameAr}
                      onChange={(e) => setDraft(role, { ...draft, nameAr: e.target.value })}
                      dir="rtl"
                    />
                  </Field>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={pending || !dirty}
                    onClick={() => save(role)}
                  >
                    {pending ? <span className="spinner" /> : null}
                    {t("Save role")}
                  </button>
                  <label style={{ flex: "1 1 200px" }}>
                    <span className="field-label">{t("Search permissions")}</span>
                    <input
                      className="input"
                      value={searches[role.id] ?? ""}
                      onChange={(e) =>
                        setSearches((current) => ({ ...current, [role.id]: e.target.value }))
                      }
                      placeholder={t("Score, waves, users…")}
                    />
                  </label>
                </div>

                {PERMISSION_GROUPS.map(({ key: groupKey, label, labelAr, permissions }) => {
                  const shown = permissions.filter(
                    (p) =>
                      !search ||
                      p.label.toLowerCase().includes(search) ||
                      p.labelAr.includes(search) ||
                      p.key.includes(search)
                  );
                  const keys = permissions.map((p) => p.key);
                  const groupStateNow = groupState(keys, draft.permissions);

                  function setGroup(next: "full" | "block") {
                    const rest = draft.permissions.filter((key) => !keys.includes(key));
                    setDraft(role, {
                      ...draft,
                      permissions: next === "full" ? [...rest, ...keys] : rest,
                    });
                  }

                  return (
                    <div key={groupKey} style={{ marginTop: 10 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                          padding: "8px 10px",
                          background: "var(--surface-sunken)",
                          borderRadius: "var(--r-sm)",
                        }}
                      >
                        <strong style={{ fontSize: 13 }}>
                          {t(label)} <span className="reg-sub">· {t(labelAr)}</span>
                        </strong>
                        <span className="reg-sub pd-num">
                          {groupStateNow === "full"
                            ? t("Full access")
                            : groupStateNow === "partial"
                              ? `${t("Partial")} · ${draft.permissions.filter((key) => keys.includes(key)).length}/${keys.length}`
                              : t("Blocked")}
                        </span>
                        <div style={{ marginInlineStart: "auto", display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            className={`chip-sm${groupStateNow === "full" ? "" : ""}`}
                            data-active={groupStateNow === "full" || undefined}
                            disabled={pending}
                            onClick={() => setGroup("full")}
                          >
                            {t("Full")}
                          </button>
                          <button
                            type="button"
                            className="chip-sm"
                            data-active={groupStateNow === "partial" || undefined}
                            disabled={pending}
                            onClick={() => setDraft(role, { ...draft })}
                          >
                            {t("Partial")}
                          </button>
                          <button
                            type="button"
                            className="chip-sm"
                            data-active={groupStateNow === "block" || undefined}
                            disabled={pending}
                            onClick={() => setGroup("block")}
                          >
                            {t("Block")}
                          </button>
                        </div>
                      </div>

                      <div style={{ padding: "6px 10px 2px" }}>
                        {shown.map((permission) => {
                          const on = draft.permissions.includes(permission.key);
                          return (
                            <label
                              key={permission.key}
                              className="checkline"
                              style={{ padding: "3px 0" }}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={pending}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...draft.permissions, permission.key]
                                    : draft.permissions.filter((key) => key !== permission.key);
                                  setDraft(role, { ...draft, permissions: next });
                                }}
                              />
                              <span>{t(permission.label)}</span>
                              <span className="reg-sub pd-num" style={{ marginInlineStart: 8 }}>
                                {permission.key}
                              </span>
                            </label>
                          );
                        })}
                        {shown.length === 0 ? (
                          <div className="reg-sub" style={{ padding: "4px 0" }}>
                            {t("Nothing matches that search.")}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
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
