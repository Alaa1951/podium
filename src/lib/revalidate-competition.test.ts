import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidate = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));

import { revalidateCompetitionViews } from "@/lib/revalidate-competition";

const appRoot = path.resolve(import.meta.dirname, "../app");

function pagesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return pagesIn(file);
    return entry.name === "page.tsx"
      ? [`/${path.relative(appRoot, directory).split(path.sep).join("/")}`]
      : [];
  });
}

beforeEach(() => revalidate.mockReset());

describe("competition invalidation route contract", () => {
  it("references real route files rather than removed admin/e prefixes or nonexistent layouts", () => {
    revalidateCompetitionViews();
    expect(revalidate).toHaveBeenCalled();
    for (const [route, kind] of revalidate.mock.calls) {
      expect(existsSync(path.join(appRoot, route.slice(1), `${kind}.tsx`)), `${route}/${kind}`).toBe(true);
    }
  });

  it("covers every competition, studio, participant and public results screen", () => {
    revalidateCompetitionViews();
    const routes = [
      "(app)/(competition)", "(app)/(studio)/studio/[series]",
      "(app)/(board)", "(app)/(me)", "(app)/my-wave", "(public)/results",
    ].flatMap((directory) => pagesIn(path.join(appRoot, directory)));
    expect(routes.length).toBeGreaterThan(30);
    for (const route of routes) {
      const covered = revalidate.mock.calls.some(([target, kind]) =>
        target === route || (kind === "layout" && route.startsWith(`${target}/`)),
      );
      expect(covered, `No invalidation for ${route}`).toBe(true);
    }
  });
});
