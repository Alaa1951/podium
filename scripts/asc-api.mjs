/** App Store Connect API client. Signing key is read locally; never logged. */
import { readFile } from 'node:fs/promises';
import { createPrivateKey, sign } from 'node:crypto';

export const appId = process.env.ASC_APP_ID || '6812904157';
export async function asc(path, { method = 'GET', data, body } = {}) {
  const keyId = process.env.ASC_KEY_ID;
  const issuer = process.env.ASC_ISSUER_ID;
  const keyPath = process.env.ASC_KEY_PATH;
  if (!keyId || !issuer || !keyPath) throw new Error('Set ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH.');
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${encode({ iss: issuer, iat: now - 10, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
  const key = createPrivateKey(await readFile(keyPath));
  const token = `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  const url = new URL(path, 'https://api.appstoreconnect.apple.com');
  if (url.origin !== 'https://api.appstoreconnect.apple.com') throw new Error('Unexpected API origin.');
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : data ? JSON.stringify({ data }) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${url.pathname}: ${response.status} ${JSON.stringify(result?.errors || result)}`);
  return result;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/asc-api.mjs')) {
  const [path, method = 'GET', jsonFile] = process.argv.slice(2);
  if (!path) throw new Error('Usage: node scripts/asc-api.mjs /v1/... [METHOD] [JSON_FILE]');
  const body = jsonFile ? JSON.parse(await readFile(jsonFile, 'utf8')) : undefined;
  console.log(JSON.stringify(await asc(path, { method, body }), null, 2));
}
