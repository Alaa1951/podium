import { requireUser } from "@/lib/session";

/**
 * THE BOARD, FULL SCREEN.
 *
 * Deliberately outside the console shell: this is what goes on the wall, and
 * a sidebar on a wall screen is a strip of navigation nobody in the room can
 * use taking up a fifth of the picture.
 *
 * The way back is the wordmark at the top of the board itself.
 *
 * Signed-in only here — an anonymous visitor of a published event is served by
 * the (public) results instead. WHO may see a given board is decided inside,
 * by the event's phase (visibility.ts): BFT MENA always, and a studio or
 * competitor once their event is on the floor.
 */
export default async function BoardLayout({ children }: LayoutProps<"/">) {
  await requireUser();
  return <>{children}</>;
}
