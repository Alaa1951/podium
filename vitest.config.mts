import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      /*
       * `server-only` RESOLVED THE WAY A SERVER BUILD RESOLVES IT.
       *
       * It is a marker package with two entries: an empty no-op under the
       * `react-server` condition, and a module that throws everywhere else.
       * Next sets that condition when it builds the server graph; Vitest does
       * not, and `resolve.conditions` does not reach it either, because a
       * package in node_modules is externalised and resolved by Node.
       *
       * Without this alias every server module carrying the marker fails to
       * load and its tests cannot run — which would be an argument for dropping
       * the marker, and the marker is exactly what makes the client/server
       * boundary enforced rather than merely intended. So the tests take the
       * same no-op the real server build takes.
       */
      "server-only": path.resolve(import.meta.dirname, "./node_modules/server-only/empty.js"),
    },
  },
});
