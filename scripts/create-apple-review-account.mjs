/** Run on the live PODIUM host with its production environment loaded.
 * Creates one explicitly authorized Apple App Review studio account: the
 * read-only "limited-admin" access role, scoped to the empty Test studio so no
 * real competitor data is reachable and nothing can be changed. No overwrites.
 * Prints the generated password once for entry in App Store Connect.
 */
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client.ts';

const email = 'apple-review@bftmiddleeast.com';
const name = 'Apple App Review';
const ACCESS_ROLE_KEY = 'limited-admin';
const SANDBOX_STUDIO_NAME = 'Test';
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function main() {
  assert(process.argv.slice(2).length === 1 && process.argv[2] === '--production', 'Run on the live host: node --env-file=<actual-production-env> scripts/create-apple-review-account.mjs --production');
  assert(process.env.NODE_ENV === 'production', 'NODE_ENV must be production. No account created.');
  assert(new URL(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost').origin === 'https://podium.bftmiddleeast.com', 'Production app origin does not match. No account created.');
  assert(process.env.DATABASE_URL, 'DATABASE_URL must come from the live service environment.');
  assert((process.env.OTP_EXEMPT_EMAILS || '').split(',').some((entry) => entry.trim().toLowerCase() === email), `Add ${email} to OTP_EXEMPT_EMAILS in the live environment first. No account created.`);
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
  try {
    const actorEmail = (process.env.DEFAULT_ADMIN_EMAIL || '').trim().toLowerCase();
    assert(actorEmail && actorEmail !== email, 'The live bootstrap admin must be configured separately.');
    const actor = await prisma.user.findUnique({ where: { email: actorEmail }, select: { id: true, role: true, status: true, archivedAt: true } });
    assert(actor?.role === 'admin' && actor.status === 'active' && !actor.archivedAt, 'Live bootstrap admin not active. No account created.');
    assert(!await prisma.user.findUnique({ where: { email }, select: { id: true } }), 'Review account already exists. Refusing to reset it or print new credentials.');
    const accessRole = await prisma.accessRole.findUnique({ where: { key: ACCESS_ROLE_KEY }, select: { id: true, permissions: true } });
    const permissions = Array.isArray(accessRole?.permissions) ? accessRole.permissions : [];
    assert(accessRole && permissions.length > 0 && permissions.every((key) => typeof key === 'string' && key.endsWith('.view')), `The ${ACCESS_ROLE_KEY} access role is missing or no longer read-only. No account created.`);
    const studio = await prisma.studio.findFirst({ where: { name: SANDBOX_STUDIO_NAME, isActive: true }, select: { id: true, name: true, _count: { select: { teams: true } } } });
    assert(studio && studio._count.teams === 0, 'The sandbox studio is missing or has teams. Refusing to attach a reviewer where real data lives.');
    const password = `Pw!${randomBytes(24).toString('base64url')}`;
    const passwordHash = await bcrypt.hash(password, 12);
    const account = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { email, name, role: 'studio', status: 'active', passwordHash, emailVerified: new Date(), locale: 'en', studioId: studio.id, accessRoleId: accessRole.id, createdById: actor.id }, select: { id: true, email: true, name: true, role: true, studioId: true, accessRoleId: true } });
      await tx.adminAuditLog.create({ data: { actorId: actor.id, action: 'account.review.create', targetType: 'user', targetId: created.id, targetLabel: email, detail: `Owner-authorized Apple App Review studio account created by production provisioning script. Read-only ${ACCESS_ROLE_KEY} permissions; scoped to the empty ${SANDBOX_STUDIO_NAME} studio.` } });
      return created;
    });
    console.log(JSON.stringify({ ...account, permissions, password, removal: 'Remove/archive Apple App Review in Users, then remove its email from OTP_EXEMPT_EMAILS and restart the service.' }, null, 2));
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error('Review account provisioning failed. Check prerequisites and connectivity on the live host; database and credential details withheld. No password reset was attempted.'); process.exitCode = 1; });
