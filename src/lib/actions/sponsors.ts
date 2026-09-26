"use server";

import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { requireAccess } from "@/lib/session";

// ─────────────────────────────────────────────────────────────────────────────
// PER-EVENT SPONSOR LOGOS.
//
// Each series carries its own ordered rail of sponsor marks, shown on the wall
// board's sponsor strip and on the published results. Artwork arrives as a
// data URL from the settings screen and is stored in the database — `public/`
// is baked into the container image, so a file written there would not survive
// a redeploy, and this way a backup carries the logos with everything else.
// ─────────────────────────────────────────────────────────────────────────────

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** The wall rail draws ten slots; beyond that a new logo would never be seen. */
const MAX_SPONSORS = 10;
/** A display-class logo sits well under this; anything larger is a mistake. */
const MAX_BYTES = 1_000_000;

const DATA_URL =
  /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=\r\n]+)$/;

const saveSchema = z.object({
  seriesId: z.string().min(1),
  sponsorId: z.string().optional(),
  alt: z.string().trim().min(1).max(80),
  position: z.coerce.number().int().min(0).max(MAX_SPONSORS - 1),
  /** "data:image/png;base64,…" — straight from the file input on the client. */
  dataUrl: z.string().min(32),
});

/** Create or replace one sponsor logo, placing it at `position`. */
export async function saveSponsor(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("sponsors.edit");

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { seriesId, sponsorId, alt, position } = parsed.data;

  const series = await prisma.series.findUnique({ where: { id: seriesId }, select: { id: true } });
  if (!series) return { ok: false, error: "NOT_FOUND" };

  // Only data URLs are accepted: they carry their type with them, so nothing
  // has to be trusted about a bare base64 body.
  const match = DATA_URL.exec(parsed.data.dataUrl);
  if (!match) return { ok: false, error: "UNSUPPORTED_TYPE" };

  const [, mimeType, base64] = match;
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > MAX_BYTES) return { ok: false, error: "TOO_LARGE" };

  const clash = await prisma.sponsor.findFirst({
    where: { seriesId, position, NOT: sponsorId ? { id: sponsorId } : undefined },
    select: { id: true },
  });
  if (clash) return { ok: false, error: "POSITION_TAKEN" };

  // Scoped to the competition in the request: a sponsor id from another
  // competition is simply not found, never rewritten.
  const before = sponsorId
    ? await prisma.sponsor.findFirst({ where: { id: sponsorId, seriesId } })
    : null;
  if (sponsorId && !before) return { ok: false, error: "NOT_FOUND" };

  const fields = { alt, position, imageB64: base64, mimeType };

  await prisma.$transaction(async (tx) => {
    if (sponsorId && before) {
      await tx.sponsor.update({ where: { id: sponsorId }, data: fields });
    } else {
      // Artwork has no diff, so a slot can only be replaced wholesale: clear
      // whatever sits at the position, then write the new mark there.
      await tx.sponsor.deleteMany({ where: { seriesId, position } });
      await tx.sponsor.create({ data: { seriesId, ...fields } });
    }
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.seriesSponsorChanged,
    targetType: "event",
    targetId: seriesId,
    targetLabel: alt,
    detail: before ? `position ${before.position} → ${position}` : `added at position ${position}`,
  });

  revalidateCompetitionViews();
  return { ok: true, message: "Sponsor saved." };
}

/** Remove one sponsor; the audit line says which. */
export async function deleteSponsor(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("sponsors.edit");

  const parsed = z
    .object({ seriesId: z.string().min(1), sponsorId: z.string().min(1) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const sponsor = await prisma.sponsor.findUnique({
    where: { id: parsed.data.sponsorId },
    select: { id: true, seriesId: true, alt: true, position: true },
  });
  if (!sponsor || sponsor.seriesId !== parsed.data.seriesId) {
    return { ok: false, error: "NOT_FOUND" };
  }

  await prisma.sponsor.delete({ where: { id: sponsor.id } });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.seriesSponsorChanged,
    targetType: "event",
    targetId: sponsor.seriesId,
    targetLabel: sponsor.alt,
    detail: `removed from position ${sponsor.position}`,
  });

  revalidateCompetitionViews();
  return { ok: true, message: "Sponsor removed." };
}

/** Switch the whole rail on or off for this event. Logos are kept either
 *  way — an event that closes its rail for one series can reopen it for the
 *  next with everything still in place. */
export async function setSponsorsEnabled(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("sponsors.edit");

  const parsed = z
    .object({ seriesId: z.string().min(1), enabled: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const series = await prisma.series.findUnique({
    where: { id: parsed.data.seriesId },
    select: { id: true, sponsorsEnabled: true },
  });
  if (!series) return { ok: false, error: "NOT_FOUND" };
  if (series.sponsorsEnabled === parsed.data.enabled) return { ok: true };

  await prisma.series.update({
    where: { id: series.id },
    data: { sponsorsEnabled: parsed.data.enabled },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.seriesSponsorChanged,
    targetType: "event",
    targetId: series.id,
    targetLabel: "Sponsor rail",
    detail: parsed.data.enabled ? "rail enabled" : "rail disabled",
  });

  revalidateCompetitionViews();
  return { ok: true };
}

/** Move one logo up or down the rail, swapping with its neighbour. */
export async function moveSponsor(input: unknown): Promise<ActionResult> {
  await requireAccess("sponsors.edit");

  const parsed = z
    .object({
      seriesId: z.string().min(1),
      sponsorId: z.string().min(1),
      direction: z.enum(["up", "down"]),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const sponsor = await prisma.sponsor.findUnique({
    where: { id: parsed.data.sponsorId },
    select: { id: true, seriesId: true, position: true },
  });
  if (!sponsor || sponsor.seriesId !== parsed.data.seriesId) {
    return { ok: false, error: "NOT_FOUND" };
  }

  const delta = parsed.data.direction === "up" ? -1 : 1;
  const targetPosition = sponsor.position + delta;
  if (targetPosition < 0 || targetPosition >= MAX_SPONSORS) return { ok: true };

  const neighbour = await prisma.sponsor.findUnique({
    where: { seriesId_position: { seriesId: sponsor.seriesId, position: targetPosition } },
    select: { id: true },
  });

  // Swap: two rows cannot hold one position, so the neighbour steps onto a
  // sentinel slot far outside the real rail (real positions are 0..9, so
  // 9999 is always free) for a beat inside the transaction, then takes the
  // vacated slot. Using a nearby "aside" slot collided whenever the rail was
  // contiguous — that was the unique-constraint crash on Up/Down.
  await prisma.$transaction(async (tx) => {
    if (neighbour) {
      await tx.sponsor.update({
        where: { id: neighbour.id },
        data: { position: MAX_SPONSORS + 1000 },
      });
    }
    await tx.sponsor.update({ where: { id: sponsor.id }, data: { position: targetPosition } });
    if (neighbour) {
      await tx.sponsor.update({ where: { id: neighbour.id }, data: { position: sponsor.position } });
    }
  });

  revalidateCompetitionViews();
  return { ok: true };
}
