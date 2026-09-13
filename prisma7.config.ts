import path from "node:path";
import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer reads .env implicitly for every command path, so load it
// here before `env()` resolves the datasource URL.
process.loadEnvFile?.(path.join(process.cwd(), ".env"));

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    url: env("DATABASE_URL"),
    // Migrate builds a throwaway database here to diff against. Same server,
    // separate name — it is created and dropped on each run.
    shadowDatabaseUrl: env("SHADOW_DATABASE_URL"),
  },
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "node --experimental-strip-types prisma/seed.ts",
  },
});
