"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/i18n/locale-provider";
import { useIsMobile } from "@/components/app/use-mobile";

export function FilterSheet({ children }: { children: ReactNode }) {
  const mobile = useIsMobile();
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open && mobile) dialog.current?.showModal(); else dialog.current?.close();
  }, [open,mobile]);
  if (!mobile) return <>{children}</>;
  return <><button type="button" className="btn btn-secondary" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{t("Filters")}</button><dialog ref={dialog} className="filter-sheet" aria-label={t("Filters")} onClose={() => setOpen(false)} onClick={(event) => {if(event.target===event.currentTarget)setOpen(false);}}><div className="filter-sheet-head"><h2>{t("Filters")}</h2><button type="button" className="btn btn-ghost" data-mobile-dismiss={open || undefined} onClick={() => setOpen(false)}>{t("Close")}</button></div><div className="filter-sheet-fields">{children}</div><button type="button" className="btn btn-primary btn-block" onClick={() => setOpen(false)}>{t("Done")}</button></dialog></>;
}
