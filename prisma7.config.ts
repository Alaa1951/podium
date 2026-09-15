import path from "node:path";
import { existsSync } from "node:fs";
import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer reads .env implicitly for every command path, so load it
// here before `env()` resolves the datasource URL. A missing file (CI and
// other environments that speak through real env vars) is not an error.
const envPath = path.join(process.cwd(), ".env");
if (existsSync(envPath)) process.loadEnvFile?.(envPath);

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
