import { describe, expect, it } from "vitest";
import { BOARD_TURN_SECONDS, moveRotation, resolveRotation } from "@/lib/board-rotation";
import type { RotationCursor } from "@/lib/board-rotation";

describe("board rotation", () => {
  const stops = [{ id: 3, pages: 3 }, { id: 4, pages: 1 }, { id: 6, pages: 2 }];

  it("finishes pages, then levels, then categories, and wraps to page one", () => {
    let cursor: RotationCursor = { id: 3, page: 0 };
    const visited = [cursor];
    for (let i = 0; i < 6; i++) {
      cursor = moveRotation(cursor, stops);
      visited.push(cursor);
    }
    expect(visited).toEqual([
      { id: 3, page: 0 }, { id: 3, page: 1 }, { id: 3, page: 2 },
      { id: 4, page: 0 }, { id: 6, page: 0 }, { id: 6, page: 1 }, { id: 3, page: 0 },
    ]);
    expect(BOARD_TURN_SECONDS).toBe(15);
  });

  it("keeps the screen and page when a new earlier bracket arrives", () => {
    const cursor = { id: 6, page: 1 };
    expect(resolveRotation(cursor, stops)).toEqual(cursor);
    expect(moveRotation(cursor, stops)).toEqual({ id: 3, page: 0 });
  });

  it("clamps a page removed by a score refresh without resetting the bracket", () => {
    expect(resolveRotation({ id: 3, page: 2 }, [{ id: 3, pages: 2 }, { id: 4, pages: 1 }]))
      .toEqual({ id: 3, page: 1 });
  });

  it("allows new pages to finish before leaving the bracket", () => {
    expect(moveRotation({ id: 3, page: 1 }, stops)).toEqual({ id: 3, page: 2 });
  });

  it("falls back safely when the current bracket is removed", () => {
    expect(resolveRotation({ id: 8, page: 4 }, stops)).toEqual({ id: 3, page: 0 });
  });

  it("cycles pages of one selected bracket, or holds its only page", () => {
    expect(moveRotation({ id: 6, page: 1 }, [{ id: 6, pages: 2 }])).toEqual({ id: 6, page: 0 });
    expect(moveRotation({ id: 6, page: 0 }, [{ id: 6, pages: 1 }])).toEqual({ id: 6, page: 0 });
  });

  it("can go backwards through pages and bracket boundaries", () => {
    expect(moveRotation({ id: 3, page: 0 }, stops, -1)).toEqual({ id: 6, page: 1 });
    expect(moveRotation({ id: 3, page: 2 }, stops, -1)).toEqual({ id: 3, page: 1 });
  });

  it("waits for the selected empty bracket, or for any first result", () => {
    expect(moveRotation({ id: null, page: 0 }, [], 1, 6)).toEqual({ id: 6, page: 0 });
    expect(resolveRotation({ id: 6, page: 2 }, [])).toEqual({ id: null, page: 0 });
    expect(resolveRotation({ id: null, page: 0 }, stops)).toEqual({ id: 3, page: 0 });
  });
});
