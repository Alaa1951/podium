import "server-only";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7 requires a driver adapter for a direct connection; the MariaDB
// adapter speaks the MySQL protocol. The pool is created once per process and
// cached on globalThis so `next dev`'s hot reload does not exhaust connections.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  return new PrismaClient({
    adapter: new PrismaMariaDb(url),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
