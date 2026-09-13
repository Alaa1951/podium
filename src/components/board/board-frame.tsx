import Link from "next/link";

import { BoardBrand } from "@/components/board/board-brand";
import { SignOutButton } from "@/components/app/sign-out-button";

/**
 * THE WALL SCREEN'S ONLY CHROME.
 *
 * A brand bar above the board, in the flow rather than floating over it — the
 * title used to collide with the wordmark on wide screens, and a wall screen
 * cannot afford a collision. The board fills everything below the bar. The bar
 * carries the way back and the way out: tap the wordmark for the menu, or sign
 * out and hand the screen to the next person.
 */
export function BoardFrame({
  back,
  name,
  children,
}: {
  back: string;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div className="board-frame">
      <div className="board-frame-bar">
        <Link href={back} className="board-frame-mark" aria-label={`${name} — back to the menu`}>
          <BoardBrand size="sm" align="start" />
          <span className="board-frame-hint">‹ Menu</span>
        </Link>
        <span className="board-frame-signout">
          <SignOutButton />
        </span>
      </div>
      <div className="board-frame-body">{children}</div>
    </div>
  );
}
