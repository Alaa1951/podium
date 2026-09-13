// ─────────────────────────────────────────────────────────────────────────────
// THE SCORING ENGINE.
//
// What a zone is, what its movements are worth, and how a pile of raw numbers
// becomes a total — all of it driven by the series' own definition rather than
// by anything written here. Series 2 can test different movements, in a
// different number of zones, without a line of this file changing.
//
// One input's points are `value × multiplyBy ÷ divideBy`, and that single shape
// covers every formula in the Series 1 scoring table:
//
//   deadlift reps  × 10 ÷ 1        rower metres  ×  1 ÷ 100
//   kettlebell rnd × 10 ÷ 1        minutes left  × 10 ÷ 1
//   bench reps     × 10 ÷ 1        seconds left  ×  1 ÷ 10
//
// Pure and dependency-free: no database, no session, no I/O. Shared by the
// server (board queries, exports) and the browser (the running total an
// operator watches while typing), so it holds no secrets.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How a movement's field is DRAWN — a separate question from what it is worth.
 *
 * `minutes` and `seconds` are the two halves of one MM:SS box, which is how the
 * BFT score sheet and the manual's own screens present the finisher. The engine
 * below never looks at this: both halves keep their own factors and are stored
 * as two whole numbers, so the arithmetic is identical either way.
 */
export type ZoneInputMode = "number" | "minutes" | "seconds";

export type ZoneInputDef = {
  id: string;
  position: number;
  label: string;
  unit: string;
  multiplyBy: number;
  divideBy: number;
  maxValue: number | null;
  inputMode: ZoneInputMode;
};

/**
 * The movements of a zone, grouped as they should be DRAWN: a `minutes` input
 * and the `seconds` input immediately after it become one MM:SS control,
 * everything else stands alone.
 *
 * Pairing is positional and adjacent on purpose — it is the same rule a person
 * reads off the definition, and it cannot silently capture a seconds field that
 * belongs to a different movement further down the zone.
 */
export type InputGroup =
  | { kind: "single"; input: ZoneInputDef }
  | { kind: "clock"; minutes: ZoneInputDef; seconds: ZoneInputDef };

export function groupInputs(zone: ZoneDef): InputGroup[] {
  const groups: InputGroup[] = [];

  for (let i = 0; i < zone.inputs.length; i++) {
    const input = zone.inputs[i];
    const next = zone.inputs[i + 1];

    if (input.inputMode === "minutes" && next?.inputMode === "seconds") {
      groups.push({ kind: "clock", minutes: input, seconds: next });
      i++;
      continue;
    }
    groups.push({ kind: "single", input });
  }

  return groups;
}

export type ZoneDef = {
  id: string;
  number: number;
  name: string;
  inputs: ZoneInputDef[];
};

/** What a team recorded, keyed by ZoneInput id. Absent or null = not entered. */
export type EntryValues = Record<string, number | null | undefined>;

// ── Arithmetic ───────────────────────────────────────────────────────────────
//
// Everything is counted in HUNDREDTHS of a point, as whole numbers, and divided
// by a hundred once at the very end. Points are quoted to two decimals, so a
// hundredth is the smallest unit that exists; adding floats and rounding at the
// end is how a total ends up a hundredth away from the number on the judge's
// sheet.

/** One input's contribution, in hundredths of a point. */
export function inputHundredths(def: Pick<ZoneInputDef, "multiplyBy" | "divideBy">, value: number) {
  const divide = def.divideBy || 1;
  return Math.round((value * def.multiplyBy * 100) / divide);
}

/** One input's contribution, in points. */
export function inputPoints(def: ZoneInputDef, value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 0;
  return inputHundredths(def, Number(value)) / 100;
}

/** One zone's points: the sum of its inputs. */
export function zonePoints(zone: ZoneDef, values: EntryValues) {
  let hundredths = 0;
  for (const input of zone.inputs) {
    const value = values[input.id];
    if (value === null || value === undefined || Number.isNaN(Number(value))) continue;
    hundredths += inputHundredths(input, Number(value));
  }
  return hundredths / 100;
}

/** Every zone's points, in board order. */
export function zoneBreakdown(zones: ZoneDef[], values: EntryValues) {
  return zones.map((zone) => ({
    id: zone.id,
    number: zone.number,
    name: zone.name,
    points: zonePoints(zone, values),
  }));
}

/** The team's total. Never stored — always derived, so a corrected factor
 *  re-scores everyone who ever recorded that movement. */
export function totalPoints(zones: ZoneDef[], values: EntryValues) {
  let hundredths = 0;
  for (const zone of zones) {
    for (const input of zone.inputs) {
      const value = values[input.id];
      if (value === null || value === undefined || Number.isNaN(Number(value))) continue;
      hundredths += inputHundredths(input, Number(value));
    }
  }
  return hundredths / 100;
}

/** Every input in board order — the score-entry form, and the export columns. */
export function allInputs(zones: ZoneDef[]): (ZoneInputDef & { zone: ZoneDef })[] {
  return zones.flatMap((zone) => zone.inputs.map((input) => ({ ...input, zone })));
}

/** A score is complete when every input of every zone has a value. */
export function isComplete(zones: ZoneDef[], values: EntryValues) {
  return allInputs(zones).every((input) => {
    const value = values[input.id];
    return value !== null && value !== undefined;
  });
}

/** How much of the form is filled, for the operator's progress line. */
export function filledCount(zones: ZoneDef[], values: EntryValues) {
  const inputs = allInputs(zones);
  const filled = inputs.filter((input) => {
    const value = values[input.id];
    return value !== null && value !== undefined;
  }).length;
  return { filled, total: inputs.length };
}

export type EntryError = { inputId: string; code: "NOT_AN_INTEGER" | "NEGATIVE" | "OVER_MAX" };

/**
 * Rejects what a judge could not have written down. The bounds come from the
 * definition — `maxValue` is 59 on a seconds field and the finisher cap on a
 * minutes one — so a new zone is validated without anything being added here.
 */
export function validateEntries(zones: ZoneDef[], values: EntryValues): EntryError[] {
  const errors: EntryError[] = [];

  for (const input of allInputs(zones)) {
    const raw = values[input.id];
    if (raw === null || raw === undefined) continue;

    const value = Number(raw);
    if (!Number.isInteger(value)) {
      errors.push({ inputId: input.id, code: "NOT_AN_INTEGER" });
      continue;
    }
    if (value < 0) errors.push({ inputId: input.id, code: "NEGATIVE" });
    else if (input.maxValue !== null && value > input.maxValue) {
      errors.push({ inputId: input.id, code: "OVER_MAX" });
    }
  }

  return errors;
}

/** "× 10", "÷ 100", "× 10 ÷ 6" — how a factor reads on screen. */
export function factorLabel(def: Pick<ZoneInputDef, "multiplyBy" | "divideBy">) {
  const parts: string[] = [];
  if (def.multiplyBy !== 1) parts.push(`× ${def.multiplyBy}`);
  if (def.divideBy !== 1) parts.push(`÷ ${def.divideBy}`);
  return parts.length ? parts.join(" ") : "× 1";
}

/** "(deadlift × 10) + (bench × 10)" — a zone's formula, spelled out. */
export function zoneFormula(zone: ZoneDef) {
  if (zone.inputs.length === 0) return "—";
  return zone.inputs
    .map((input) => `(${input.label.toLowerCase()} ${factorLabel(input)})`)
    .join(" + ");
}

// ── The starting definition ──────────────────────────────────────────────────

/**
 * Series 1's zones, as the scoring table defines them. This is a STARTING
 * POINT written into a new series, not a rule: once written it is rows in the
 * database that BFT MENA edits, and nothing reads it again.
 */
export const DEFAULT_ZONES: {
  number: number;
  name: string;
  inputs: Omit<ZoneInputDef, "id">[];
}[] = [
  {
    number: 1,
    name: "Strength",
    inputs: [
      { position: 1, label: "Deadlift reps", unit: "reps", multiplyBy: 10, divideBy: 1, maxValue: null, inputMode: "number" },
      { position: 2, label: "Bench press reps", unit: "reps", multiplyBy: 10, divideBy: 1, maxValue: null, inputMode: "number" },
    ],
  },
  {
    number: 2,
    name: "Conditioning",
    inputs: [
      { position: 1, label: "Rower distance", unit: "m", multiplyBy: 1, divideBy: 100, maxValue: null, inputMode: "number" },
    ],
  },
  {
    number: 3,
    name: "Strength endurance",
    inputs: [
      { position: 1, label: "Kettlebell rounds", unit: "rounds", multiplyBy: 10, divideBy: 1, maxValue: null, inputMode: "number" },
      { position: 2, label: "Dumbbell rounds", unit: "rounds", multiplyBy: 10, divideBy: 1, maxValue: null, inputMode: "number" },
    ],
  },
  {
    number: 4,
    name: "Finisher",
    // Time REMAINING against the cap, which is why a bigger number is better.
    // Drawn as one MM:SS box, exactly as the judge's sheet is written, but
    // scored as two numbers with their own factors — see ZoneInputMode.
    inputs: [
      { position: 1, label: "Minutes remaining", unit: "min", multiplyBy: 10, divideBy: 1, maxValue: 15, inputMode: "minutes" },
      { position: 2, label: "Seconds remaining", unit: "sec", multiplyBy: 1, divideBy: 10, maxValue: 59, inputMode: "seconds" },
    ],
  },
];
