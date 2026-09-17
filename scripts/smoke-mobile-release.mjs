/** Read-only checks after the gated web deployment. No account or inbox writes. */
import { readFile } from 'node:fs/promises';
const origin = new URL(process.argv[2] || 'https://podium.bftmiddleeast.com');
if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('Pass an origin only.');
if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) throw new Error('HTTPS required outside localhost.');
let failed = false;
async function check(label, path, status, cookie, validate) {
  try {
    const response = await fetch(new URL(path, origin), {
      headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
    if (response.status !== status) throw new Error(`expected HTTP ${status}, received ${response.status}`);
    if (validate) await validate(response);
    console.log(`PASS ${label} (HTTP ${status})`);
  } catch (error) { failed = true; console.error(`FAIL ${label}: ${error.message}`); }
}
await check('Privacy policy', '/privacy', 200, null, async r => {
  if (!(await r.text()).includes('admin@bftmiddleeast.com')) throw new Error('Privacy contact is missing.');
});
await check('Results entry', '/results', 200);
await check('Database health', '/api/health', 200, null, async r => {
  const health = await r.json();
  if (health.status !== 'ok' || health.database !== 'up') throw new Error('Database is not ready.');
});
const privateCache = r => {
  if (!r.headers.get('cache-control')?.includes('private') || !r.headers.get('cache-control')?.includes('no-store')
    || !r.headers.get('vary')?.toLowerCase().includes('cookie')) throw new Error('Private response cache headers are missing.');
};
await check('Guest inbox protection', '/api/notifications', 401, null, async r => {
  if ((await r.json()).error !== 'UNAUTHORIZED') throw new Error('Unexpected guest response.');
});
if (process.env.PODIUM_SMOKE_COOKIE_FILE) {
  // The file contains a Cookie header value only. Keep it outside the repository.
  const cookie = (await readFile(process.env.PODIUM_SMOKE_COOKIE_FILE, 'utf8')).trim();
  if (!cookie || /[\r\n]/.test(cookie)) throw new Error('Cookie file must contain one non-empty line.');
  await check('Signed-in inbox', '/api/notifications', 200, cookie, async r => {
    privateCache(r);
    const inbox = await r.json();
    if (!Array.isArray(inbox.items) || !Number.isInteger(inbox.unreadCount)) throw new Error('Unexpected inbox data.');
  });
} else console.log('SKIP signed-in inbox: set PODIUM_SMOKE_COOKIE_FILE to a private file containing a current session cookie.');
process.exitCode = failed ? 1 : 0;
