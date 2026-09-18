"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { FilterSheet } from "@/components/app/filter-sheet";

/**
 * One search box and three filters, all of them in the URL.
 *
 * In the URL rather than in component state, so a filtered list can be sent to
 * somebody, reloaded, or arrived at from the dashboard's figures — clicking
 * "12 awaiting payment" has to land on those twelve.
 */
export function RegisteredFilters({
  query,
  payment,
  membership,
  wave,
  showing,
  total,
}: {
  query: string;
  payment: string;
  membership: string;
  wave: string;
  showing: number;
  total: number;
  studios: string[];
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(query);

  // The URL is the source of truth: a back button, or a link from the
  // dashboard, has to be reflected in the box.
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    setText(query);
  }

  function apply(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (!value || value === "all") next.delete(key);
      else next.set(key, value);
    }
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  }

  // Typing does not hammer the server: the search settles first.
  useEffect(() => {
    if (text === query) return;
    const id = setTimeout(() => apply({ q: text }), 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const clear = query || payment !== "all" || membership !== "all" || wave !== "all";

  return (
    <div className="reg-filters">
      <input
        className="input"
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("Search team name, competitor, email, phone or number…")}
        aria-label={t("Search registrations")}
        style={{ flex: "1 1 260px", minWidth: 0 }}
      />

      <FilterSheet><Select
        label={t("Payment")}
        value={payment}
        onChange={(value) => apply({ payment: value })}
        options={[
          { value: "all", label: t("Any payment") },
          { value: "paid", label: t("Paid") },
          { value: "pending", label: t("Awaiting payment") },
          { value: "refunded", label: t("Refunded") },
        ]}
      />

      <Select
        label={t("Membership")}
        value={membership}
        onChange={(value) => apply({ membership: value })}
        options={[
          { value: "all", label: t("Members and non-members") },
          { value: "members", label: t("Has a BFT member") },
          { value: "non-members", label: t("No BFT member") },
        ]}
      />

      <Select
        label={t("Wave")}
        value={wave}
        onChange={(value) => apply({ wave: value })}
        options={[
          { value: "all", label: t("Any wave") },
          { value: "assigned", label: t("In a wave") },
          { value: "unassigned", label: t("Not in a wave") },
        ]}
      />

      </FilterSheet><div className="reg-filters-count">
        {showing === total
          ? `${total} ${t("registered")}`
          : `${showing} ${t("of")} ${total}`}
        {clear ? (
          <button
            type="button"
            className="linkish"
            disabled={pending}
            onClick={() => {
              setText("");
              apply({ q: "", payment: "all", membership: "all", wave: "all" });
            }}
            style={{ marginInlineStart: 8 }}
          >
            {t("Clear")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      className="input"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ flex: "0 1 auto", fontSize: 13 }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
