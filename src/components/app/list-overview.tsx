"use client";

import { useId, useState, type ReactNode } from "react";
import { useT } from "@/components/i18n/locale-provider";

import "./list-search.css";

/** Keep the list within reach on phones, with its full overview still available. */
export function ListOverview({ children, label }: { children: ReactNode; label?: string }) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <section className="list-overview" data-open={open || undefined}>
      <button type="button" className="btn btn-secondary list-overview-toggle"
        aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        {label ?? t("Overview")} <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <div id={id} className="list-overview-content">{children}</div>
    </section>
  );
}
