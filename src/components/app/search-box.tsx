"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useT } from "@/components/i18n/locale-provider";

import "./list-search.css";

// ─────────────────────────────────────────────────────────────────────────────
// THE SEARCH BOX every long list uses.
//
//   • "/" jumps to it from anywhere on the page; Esc clears it, then leaves it.
//   • A clear button once something is typed.
//   • The count of what is showing, read out to screen readers as it changes.
//   • type="search" + enterKeyHint, so a phone shows a Search key and no
//     autocorrect fights a name or an email.
// What it matches is src/lib/search.ts.
// ─────────────────────────────────────────────────────────────────────────────

export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
  shown,
  total,
  pending = false,
  inputClassName = "",
  maxLength,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** What is being searched, for screen readers. */
  label: string;
  /** How many rows show, of how many — the count beside the box. */
  shown?: number;
  total?: number;
  pending?: boolean;
  inputClassName?: string;
  maxLength?: number;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counted = shown !== undefined && total !== undefined;
  return (
    <div className="search-box" data-counted={counted} aria-busy={pending}>
      <svg className="search-box-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={input}
        className={`input search-box-input ${inputClassName}`}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={label}
        aria-keyshortcuts="/"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            input.current?.blur();
            return;
          }
          if (event.key !== "Escape") return;
          if (value) onChange("");
          else input.current?.blur();
        }}
      />
      {value ? (
        <button type="button" className="search-box-clear" onClick={() => { onChange(""); input.current?.focus(); }} aria-label={t("Clear search")}>
          ×
        </button>
      ) : (
        <kbd className="search-box-key desktop-only" aria-hidden="true">/</kbd>
      )}
      {counted ? (
        <span className="search-box-count pd-num" aria-live="polite">
          {pending ? t("Searching…") : shown === total ? t("{count} shown", { count: total }) : t("{shown} of {total}", { shown, total })}
        </span>
      ) : null}
    </div>
  );
}

/**
 * List filters kept in the address, so Back, a refresh or a shared link comes
 * back to the same list. Updates the address in place (history.replaceState):
 * nothing reloads, and typing never adds a history entry per letter.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]): [Record<K, string>, (changes: Partial<Record<K, string>>) => void] {
  const params = useSearchParams();
  const [values, setValues] = useState<Record<K, string>>(
    () => Object.fromEntries(keys.map((key) => [key, params.get(key) ?? ""])) as Record<K, string>
  );
  const latest = useRef(values);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback(
    (changes: Partial<Record<K, string>>) => {
      const next = { ...latest.current, ...changes };
      latest.current = next;
      setValues(next);
      if (pending.current) clearTimeout(pending.current);
      // Settle before writing the address: once per pause, not per letter.
      pending.current = setTimeout(() => {
        const url = new URL(window.location.href);
        for (const key of keys) {
          if (next[key]) url.searchParams.set(key, next[key]);
          else url.searchParams.delete(key);
        }
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      }, 300);
    },
    [keys]
  );

  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current);
  }, []);

  return [values, update];
}
