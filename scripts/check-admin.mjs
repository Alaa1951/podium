import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client.ts";

process.loadEnvFile?.(path.join(process.cwd(), ".env"));
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });

const user = await prisma.user.findUnique({
  where: { email: "alaa1951gm@gmail.com" },
  select: { id: true, email: true, role: true, status: true, passwordHash: true },
});
if (!user) {
  console.log("USER NOT FOUND");
  process.exit(0);
}
const ok = await bcrypt.compare("PodiumDev!2026", user.passwordHash ?? "");
console.log("email:", user.email);
console.log("role:", user.role, "| status:", user.status);
console.log("hash matches PodiumDev!2026:", ok);
process.exit(0);
