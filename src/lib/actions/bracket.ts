"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { BracketError } from "@/lib/bracket";
import { changeBracket } from "@/lib/bracket-change";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { getCurrentUser } from "@/lib/session";

// ─────────────────────────────────────────────────────────────────────────────
// The two buttons that change a team's category or level:
//
//   changeMyBracket       the athlete, on their own page, for their own team;
//   assistBracketChange   staff (registrations.bracket), for a team in their
//                         scope — only with the box ticked that says the
//                         athlete asked for it and approves.
//
// Everything is decided in bracket-change.ts; this is the session, the
// input's shape and the pages to refresh. Answered, never redirected: both
// are pressed from screens that must not lose their place.
// ─────────────────────────────────────────────────────────────────────────────

export type BracketActionResult =
  | { ok: true; changed: boolean; category: string; division: string }
  | { ok: false; error: BracketError | "UNAUTHENTICATED" };

const category = z.enum(["Womens", "Mens", "Mixed"]);
const division = z.enum(["Rookie", "Open", "Pro"]);
const base = {
  teamId: z.string().min(1).max(191),
  category,
  division,
  expectedCategory: category,
  expectedDivision: division,
};
const athleteSchema = z.object(base);
const staffSchema = z.object({ ...base, athleteApproved: z.boolean() });

function refresh(changed: boolean) {
  if (!changed) return;
  revalidateCompetitionViews();
  revalidatePath("/me");
}

/** An athlete changing the category or level of the team they are on. */
export async function changeMyBracket(input: unknown): Promise<BracketActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "UNAUTHENTICATED" };
  if (user.viewAs || user.role !== "competitor") return { ok: false, error: "FORBIDDEN" };
  const parsed = athleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const data = parsed.data;

  const outcome = await changeBracket(prisma, user, {
    by: "athlete",
    teamId: data.teamId,
    category: data.category,
    division: data.division,
    expected: { category: data.expectedCategory, division: data.expectedDivision },
  });
  if (!outcome.ok) return outcome;
  refresh(outcome.changed);
  return outcome;
}

/** Staff changing it for an athlete who asked — and said yes to — the change. */
export async function assistBracketChange(input: unknown): Promise<BracketActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "UNAUTHENTICATED" };
  if (user.viewAs) return { ok: false, error: "FORBIDDEN" };
  const parsed = staffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const data = parsed.data;

  const outcome = await changeBracket(prisma, user, {
    by: "staff",
    athleteApproved: data.athleteApproved,
    teamId: data.teamId,
    category: data.category,
    division: data.division,
    expected: { category: data.expectedCategory, division: data.expectedDivision },
  });
  if (!outcome.ok) return outcome;
  refresh(outcome.changed);
  return outcome;
}
