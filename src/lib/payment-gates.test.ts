/**
 * A CONTRACT TEST OVER THE SOURCE, not over behaviour.
 *
 * "Money does not buy a place" is enforced by one expression in
 * `team-status.ts` — `isCompeting()` — and by every gate in the codebase asking
 * it instead of comparing payment itself. The second half is the fragile half.
 * `isCompeting` existed, was tested, and was called by NOTHING for months while
 * four screens each wrote `paymentStatus === "paid"` inline; that is how the
 * rule came to be missing from the places that mattered.
 *
 * A behaviour test cannot catch the regression, because the regression is a
 * NEW gate somewhere that nobody thought to test. So this reads the source and
 * fails on the pattern itself. It is deliberately blunt: if a comparison is
 * genuinely needed somewhere new, the fix is to add it to `ALLOWED` with a
 * reason, which is a line a reviewer will see.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..");

/**
 * Files that may compare payment directly, and why.
 *
 * `team-status.ts` owns the rule. The payment ACTIONS and the payment filter
 * are about the money itself rather than about who is competing, which is a
 * different question and the one place the comparison belongs.
 */
const ALLOWED = new Set([
  "lib/team-status.ts",
  // Sets the money; the comparison there is about what changed, not who competes.
  "lib/actions/payments.ts",
  // Reports COUNT the payment states separately — pending and refunded are
  // figures in their own right, not a gate on competing.
  "lib/reports.ts",
  // Creating a registration reads the money off the form to set paidAt.
  "lib/actions/registrations.ts",
  // The registrations screen's payment filter, which exists to filter by money.
  "screens/registrations.tsx",
  // The row shows the money panel; it asks `row.waitlisted` separately.
  "components/admin/registered-row.tsx",
]);

/** Every .ts/.tsx under src, excluding tests and the generated client. */
function sourceFiles(dir = SRC, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "generated" || entry === "node_modules") continue;
      sourceFiles(full, found);
      continue;
    }
    if (!/\.tsx?$/.test(entry) || entry.includes(".test.")) continue;
    found.push(full);
  }
  return found;
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

describe("the one gate", () => {
  it("is the only place payment is compared to decide who is competing", () => {
    // Matches `paymentStatus === "paid"` and `paymentStatus !== "paid"`, in any
    // quoting style, which is how every one of the old inline copies was written.
    const inline = /paymentStatus\s*[!=]==\s*["'`]paid["'`]/;

    const offenders = sourceFiles()
      .filter((file) => inline.test(readFileSync(file, "utf8")))
      .map(rel)
      .filter((file) => !ALLOWED.has(file));

    expect(offenders).toEqual([]);
  });

  it("keeps the waiting list out of prisma filters that mean 'competing'", () => {
    // The other shape the mistake takes: `where: { paymentStatus: "paid" }` in
    // a query whose purpose is the board or the field, with no waitlistedAt
    // beside it. Counting money is fine; deciding a place is not.
    const where = /paymentStatus:\s*["'`]paid["'`]/;

    const offenders = sourceFiles()
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        if (!where.test(text)) return false;
        // A query that also mentions the waiting list has thought about it.
        return !text.includes("waitlistedAt");
      })
      .map(rel)
      .filter((file) => !ALLOWED.has(file));

    // Known and deliberate: the platform dashboard and the competition nav
    // badge count MONEY, not places. Listed here rather than in ALLOWED so
    // that the reason sits next to the assertion.
    const countsMoneyOnPurpose = [
      "app/(app)/(platform)/page.tsx",
      "app/(app)/(competition)/series/[series]/layout.tsx",
    ];
    expect(offenders.filter((file) => !countsMoneyOnPurpose.includes(file))).toEqual([]);
  });

  it("finds the file it is guarding, so a rename cannot make it pass vacuously", () => {
    // Without this, moving team-status.ts would leave a test that greps for a
    // pattern in a set of files that no longer contains the rule, and passes.
    const files = sourceFiles().map(rel);
    expect(files).toContain("lib/team-status.ts");
    expect(readFileSync(path.join(SRC, "lib/team-status.ts"), "utf8")).toContain("isCompeting");
  });
});
