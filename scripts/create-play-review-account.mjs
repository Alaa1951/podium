/** Run on the live PODIUM host with its production environment loaded.
 * Creates one explicitly authorized Google Play reviewer admin; no overwrites.
 * Prints the generated password once for entry in Play Console; never saves it.
 */
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client.ts';

const email = 'google-play-review@bftmiddleeast.com';
const name = 'Google Play Review';
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function main() {
  assert(process.argv.slice(2).length === 1 && process.argv[2] === '--production', 'Run on the live host: node --env-file=<actual-production-env> scripts/create-play-review-account.mjs --production');
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
    const password = `Pw!${randomBytes(24).toString('base64url')}`;
    const passwordHash = await bcrypt.hash(password, 12);
    const account = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { email, name, role: 'admin', status: 'active', passwordHash, emailVerified: new Date(), locale: 'en', createdById: actor.id }, select: { id: true, email: true, name: true, role: true } });
      await tx.adminAuditLog.create({ data: { actorId: actor.id, action: 'account.review.create', targetType: 'user', targetId: created.id, targetLabel: email, detail: 'Owner-authorized Google Play review admin created by production provisioning script.' } });
      return created;
    });
    console.log(JSON.stringify({ ...account, password, removal: 'Disable/archive Google Play Review in Users, then remove its email from OTP_EXEMPT_EMAILS and restart the service.' }, null, 2));
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error('Review account provisioning failed. Check prerequisites and connectivity on the live host; database and credential details withheld. No password reset was attempted.'); process.exitCode = 1; });
