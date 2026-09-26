/**
 * THE TEST ACCOUNTS — one per role (src/lib/permissions/test-account-roles.ts).
 *
 * Creates each missing one, and brings each existing one back to exactly its
 * definition: its account type, its roles and nothing else (no per-person
 * grants or locks), approved, active, and the password given. It never
 * touches an account that is not one of these addresses, and never a Full
 * access account even at one of them.
 *
 * On the live host, with the service's own environment loaded:
 *
 *   TEST_ACCOUNT_PASSWORD='<password>' node --env-file=/opt/podium/.env scripts/test-accounts.mjs --production
 *
 * Options (combine freely):
 *   --place <competition-slug>  put test_zone_leader on the first zone of that
 *                               competition with no leader, as its leader, and
 *                               each test judge on the same zone, on its own
 *                               station (test_judge 1, test_judge2 2)
 *   --block                     switch every test account off (Users → Block)
 *   --unblock                   switch them back on
 *
 * The password is never stored here or printed — the repository is public.
 * An address must be on the server's TEST_ACCOUNT_EMAILS before it is created
 * or reset, or its first sign-in would email a code to a mailbox that does not
 * exist (src/lib/test-accounts.ts). Without --production it runs only against
 * a local database.
 */
import bcrypt from 'bcryptjs';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

import { PrismaClient } from '../src/generated/prisma/client.ts';
import { MIN_PASSWORD_LENGTH } from '../src/lib/password-rules.ts';
import { TEST_ACCOUNTS, testAccountEmail } from '../src/lib/permissions/test-account-roles.ts';

const SANDBOX_STUDIO_NAME = 'Test';
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const fail = (message) => {
  console.error(`Refusing: ${message}`);
  process.exit(1);
};

const production = flag('--production');
const url = process.env.DATABASE_URL || '';
if (!url) fail('DATABASE_URL is not set — load the environment first (node --env-file=…).');
if (production) {
  if (process.env.NODE_ENV !== 'production') fail('NODE_ENV must be production with --production.');
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost').origin;
  if (origin !== 'https://podium.bftmiddleeast.com') fail(`the environment is not the live app (${origin}).`);
} else if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  fail('DATABASE_URL is not a local database. Pass --production on the live host.');
}

const block = flag('--block');
const unblock = flag('--unblock');
if (block && unblock) fail('--block and --unblock together.');
const placeSlug = option('--place');
if (args.includes('--place') && !placeSlug) fail('--place needs a competition slug.');
const provisioning = !block && !unblock;

const password = process.env.TEST_ACCOUNT_PASSWORD || '';
if (provisioning && password.length < MIN_PASSWORD_LENGTH) {
  fail(`set TEST_ACCOUNT_PASSWORD (at least ${MIN_PASSWORD_LENGTH} characters) for this run.`);
}

const listed = new Set(
  (process.env.TEST_ACCOUNT_EMAILS || '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean)
);

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(url) });

async function actorId() {
  const email = (process.env.DEFAULT_ADMIN_EMAIL || '').trim().toLowerCase();
  const byEmail = email
    ? await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, status: true, archivedAt: true } })
    : null;
  if (byEmail?.role === 'admin' && byEmail.status === 'active' && !byEmail.archivedAt) return byEmail.id;
  const any = await prisma.user.findFirst({ where: { role: 'admin', status: 'active', archivedAt: null }, select: { id: true } });
  if (!any) fail('no active Full access account to record as the one who did this.');
  return any.id;
}

async function audit(actor, action, target, detail) {
  await prisma.adminAuditLog.create({
    data: { actorId: actor, action, targetType: 'user', targetId: target.id, targetLabel: target.email, detail },
  });
}

async function provision(actor) {
  const passwordHash = await bcrypt.hash(password, 12);
  // Active or retired alike: retiring only hides a studio from the pickers,
  // which suits a sandbox — its account signs in and is scoped the same.
  const sandbox = await prisma.studio.findFirst({
    where: { name: SANDBOX_STUDIO_NAME },
    select: { id: true, _count: { select: { teams: true } } },
  });
  const rows = [];

  for (const def of TEST_ACCOUNTS) {
    const email = testAccountEmail(def.slug);
    const row = { email, type: def.accountType, roles: def.roles.join(', '), result: '' };
    rows.push(row);

    if (!listed.has(email)) {
      row.result = 'SKIPPED — add it to TEST_ACCOUNT_EMAILS first';
      continue;
    }
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
    if (existing?.role === 'admin') {
      row.result = 'SKIPPED — a Full access account is never touched';
      continue;
    }
    const roles = await prisma.accessRole.findMany({ where: { key: { in: def.roles } }, select: { id: true, key: true } });
    if (roles.length !== def.roles.length) {
      row.result = `SKIPPED — role missing: ${def.roles.filter((key) => !roles.some((role) => role.key === key)).join(', ')}`;
      continue;
    }
    let studioId = null;
    if (def.sandboxStudio) {
      // Never a real gym: a studio login sees its studio's teams and people.
      if (!sandbox || sandbox._count.teams > 0) {
        row.result = `SKIPPED — needs the empty "${SANDBOX_STUDIO_NAME}" studio`;
        continue;
      }
      studioId = sandbox.id;
    }

    const now = new Date();
    const data = {
      name: def.name,
      role: def.accountType,
      status: 'active',
      approvalStatus: 'approved',
      approvedAt: now,
      approvedById: actor,
      passwordHash,
      emailVerified: now,
      studioId,
      archivedAt: null,
      permissionOverrides: { grant: [], deny: [] },
      forceOtpNextLogin: false,
    };
    const user = await prisma.$transaction(async (tx) => {
      const saved = existing
        ? await tx.user.update({ where: { id: existing.id }, data, select: { id: true, email: true } })
        : await tx.user.create({ data: { ...data, email, locale: 'en', createdById: actor }, select: { id: true, email: true } });
      await tx.userAccessRole.deleteMany({ where: { userId: saved.id } });
      await tx.userAccessRole.createMany({
        data: roles.map((role) => ({ userId: saved.id, accessRoleId: role.id, assignedById: actor })),
      });
      return saved;
    });
    await audit(actor, 'account.test_provisioned', user, `test account ${existing ? 'reset' : 'created'}: ${def.accountType}; roles ${def.roles.join(', ')}`);
    row.result = existing ? 'reset' : 'created';
  }
  return rows;
}

async function place(actor, slug) {
  const series = await prisma.series.findUnique({ where: { slug }, select: { id: true, name: true, archivedAt: true } });
  if (!series || series.archivedAt) fail(`no competition "${slug}".`);
  const posted = TEST_ACCOUNTS.filter((def) => def.post);
  const people = await Promise.all(
    posted.map(async (def) => ({
      def,
      user: await prisma.user.findUnique({ where: { email: testAccountEmail(def.slug) }, select: { id: true, email: true } }),
    }))
  );
  if (people.some((one) => !one.user)) fail('create the test accounts before placing them.');
  const leader = people.find((one) => one.def.post === 'leader')?.user;
  const zones = await prisma.zone.findMany({
    where: { seriesId: series.id },
    orderBy: { number: 'asc' },
    select: { id: true, number: true, staff: { where: { position: 'leader' }, select: { userId: true } } },
  });
  // Never demote a real leader: the first zone with no leader, or the one the
  // test leader already leads.
  const zone = zones.find((row) => row.staff.length === 0 || row.staff.some((one) => one.userId === leader?.id));
  if (!zone) fail(`every zone of "${slug}" already has a leader — place the test accounts from Wave control instead.`);

  await prisma.$transaction(async (tx) => {
    for (const { def, user } of people) {
      const position = def.post === 'leader' ? 'leader' : 'judge';
      const station = def.post === 'leader' ? null : def.station ?? null;
      await tx.zoneStaff.upsert({
        where: { zoneId_userId: { zoneId: zone.id, userId: user.id } },
        create: { seriesId: series.id, zoneId: zone.id, userId: user.id, position, station, assignedById: actor },
        update: { position, station, assignedById: actor },
      });
    }
  });
  const placed = people.map(({ def, user }) => `${user.email} ${def.post === 'leader' ? 'leader' : `judge, station ${def.station}`}`);
  for (const detail of placed) {
    await prisma.adminAuditLog.create({
      data: { actorId: actor, action: 'zone.staff_changed', targetType: 'event', targetId: series.id, targetLabel: `Zone ${zone.number}`, detail: `${detail} (test account)` },
    });
  }
  return `${series.name}: Zone ${zone.number} — ${placed.join('; ')}`;
}

async function setStatus(actor, status) {
  const emails = TEST_ACCOUNTS.map((def) => testAccountEmail(def.slug));
  const users = await prisma.user.findMany({ where: { email: { in: emails }, role: { not: 'admin' } }, select: { id: true, email: true } });
  await prisma.user.updateMany({ where: { id: { in: users.map((user) => user.id) } }, data: { status } });
  for (const user of users) await audit(actor, status === 'disabled' ? 'account.disabled' : 'account.enabled', user, 'test account');
  return users.length;
}

try {
  const actor = await actorId();
  if (provisioning) {
    const rows = await provision(actor);
    console.table(rows);
    const missing = rows.filter((row) => !listed.has(row.email)).map((row) => row.email);
    if (missing.length) {
      console.log(`\nNot on TEST_ACCOUNT_EMAILS: ${missing.join(', ')}`);
      console.log(`The full list for the server's .env:\nTEST_ACCOUNT_EMAILS=${TEST_ACCOUNTS.map((def) => testAccountEmail(def.slug)).join(',')}`);
    }
  }
  if (placeSlug) console.log(`\nPlaced: ${await place(actor, placeSlug)}`);
  if (block) console.log(`\nBlocked ${await setStatus(actor, 'disabled')} test accounts — they cannot sign in.`);
  if (unblock) console.log(`\nUnblocked ${await setStatus(actor, 'active')} test accounts.`);
} catch (error) {
  console.error('Test account provisioning failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
