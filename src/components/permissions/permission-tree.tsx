"use client";

import type { ReactNode } from "react";

import { useLocale } from "@/components/i18n/locale-provider";

// ─────────────────────────────────────────────────────────────────────────────
// THE PERMISSION TREE — Module → Screen → one row per action.
//
// Shared by the Roles screen and a person's Access panel; only the control on
// each row differs, so both render through `renderRow`. The tree itself knows
// nothing about policy: callers pass rows already decided on the server.
// ─────────────────────────────────────────────────────────────────────────────

export type TreeRow = { key: string; label: string; labelAr: string };

export type TreeScreen<R extends TreeRow> = {
  key: string;
  label: string;
  labelAr: string;
  rows: R[];
};

export type TreeModule<R extends TreeRow> = {
  key: string;
  label: string;
  labelAr: string;
  screens: TreeScreen<R>[];
};

export function PermissionTree<R extends TreeRow>({
  modules,
  search = "",
  renderRow,
  screenSummary,
  screenActions,
  moduleSummary,
  defaultOpen = true,
}: {
  modules: TreeModule<R>[];
  search?: string;
  renderRow: (row: R) => ReactNode;
  screenSummary?: (screen: TreeScreen<R>) => ReactNode;
  screenActions?: (screen: TreeScreen<R>) => ReactNode;
  moduleSummary?: (module: TreeModule<R>) => ReactNode;
  defaultOpen?: boolean;
}) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const needle = search.trim().toLowerCase();
  const matches = (row: R, screen: TreeScreen<R>) =>
    !needle ||
    row.key.toLowerCase().includes(needle) ||
    row.label.toLowerCase().includes(needle) ||
    row.labelAr.includes(needle) ||
    screen.label.toLowerCase().includes(needle) ||
    screen.labelAr.includes(needle);

  return (
    <div className="perm-tree">
      {modules.map((module) => {
        const screens = module.screens
          .map((screen) => ({ ...screen, rows: screen.rows.filter((row) => matches(row, screen)) }))
          .filter((screen) => screen.rows.length > 0);
        if (!screens.length) return null;
        return (
          <details key={module.key} className="perm-module" open={defaultOpen || !!needle}>
            <summary>
              <span>{ar ? module.labelAr : module.label}</span>
              {moduleSummary ? <span className="reg-sub pd-num">{moduleSummary(module)}</span> : null}
            </summary>
            {screens.map((screen) => (
              <section key={screen.key} className="perm-screen">
                <div className="perm-screen-head">
                  <strong>{ar ? screen.labelAr : screen.label}</strong>
                  {screenSummary ? <span className="reg-sub pd-num">{screenSummary(screen)}</span> : null}
                  {screenActions ? <span className="push">{screenActions(screen)}</span> : null}
                </div>
                {screen.rows.map((row) => (
                  <div key={row.key}>{renderRow(row)}</div>
                ))}
              </section>
            ))}
          </details>
        );
      })}
    </div>
  );
}

/** "Block", "Partial · 2/5" or "Full" for a set of rows. */
export function coverageLabel(on: number, total: number, t: (key: string) => string): string {
  if (on === 0) return t("Blocked");
  if (on === total) return t("Full access");
  return `${t("Partial")} · ${on}/${total}`;
}
