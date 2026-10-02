"use client";

import { useEffect, useId, useRef, useState } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { matchesSearch } from "@/lib/search";

import "./staff-person-picker.css";

/** An in-page list so phone users can type instead of scrolling a native select. */
export function StaffPersonPicker({ candidates, value, onChange, disabled = false }: {
  candidates: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const selected = candidates.find((person) => person.id === value);
  const results = candidates.filter((person) => matchesSearch(query, { text: [person.label] }));
  const expanded = open && !disabled;

  useEffect(() => {
    if (expanded && active >= 0) {
      list.current?.children[active]?.scrollIntoView({ block: "nearest" });
    }
  }, [active, expanded]);

  function choose(person: { id: string }) {
    onChange(person.id);
    setOpen(false);
    setQuery("");
    setActive(-1);
    input.current?.blur();
  }

  return (
    <div className="staff-person-picker" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        setOpen(false);
        setQuery("");
        setActive(-1);
      }
    }}>
      <label className="field-label" htmlFor={id}>{t("Add a judge")}</label>
      <div className="staff-person-input">
        <input
          ref={input}
          id={id}
          className="input"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={`${id}-list`}
          aria-activedescendant={expanded && active >= 0 && results[active] ? `${id}-option-${active}` : undefined}
          placeholder={t("Search by name or email…")}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          disabled={disabled}
          value={expanded ? query : selected?.label ?? ""}
          onFocus={() => { setOpen(true); setQuery(""); setActive(-1); }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(-1);
            if (value) onChange("");
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              setActive((current) => results.length === 0 ? -1 : event.key === "ArrowDown"
                ? Math.min(current + 1, results.length - 1)
                : current < 0 ? results.length - 1 : Math.max(current - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (expanded && results[active]) choose(results[active]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              setQuery("");
              setActive(-1);
              input.current?.blur();
            }
          }}
        />
        {(value || query) && !disabled ? (
          <button type="button" className="staff-person-clear" aria-label={t("Clear selection")}
            onClick={() => { onChange(""); setQuery(""); setActive(-1); input.current?.focus(); }}>
            ×
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div className="staff-person-results">
          <div className="staff-person-count" role="status">
            {results.length ? t("{shown} of {total}", { shown: results.length, total: candidates.length })
              : candidates.length ? t("No matching people. Try another name or email.") : t("No people available to add.")}
          </div>
          <div ref={list} id={`${id}-list`} className="staff-person-list" role="listbox" aria-label={t("Choose a person…")}>
            {results.map((person, index) => (
              <button key={person.id} id={`${id}-option-${index}`} type="button" role="option"
                aria-selected={person.id === value} data-active={index === active}
                className="staff-person-option" onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(person)}>
                {person.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
