"use client";

/** Print the receipt; the page's print styles leave only the record. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className="btn btn-secondary waiver-print" onClick={() => window.print()}>
      {label}
    </button>
  );
}
