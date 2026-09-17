/** PODIUM internal release only. Credentials and upload files stay outside the repo. */
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JWT } from 'google-auth-library';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const sharp = require(require.resolve('sharp', { paths: [dirname(require.resolve('next/package.json'))] }));
export const packageName = 'app.podium.bftmena';
const language = 'en-GB';
// Published contact in PODIUM's live privacy policy and MOBILE-PLAY.md.
const supportEmail = 'admin@bftmiddleeast.com';
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/edits`;
const uploadBase = base.replace('/androidpublisher/v3/', '/upload/androidpublisher/v3/');
const signingDir = 'C:/Users/Alaa/podium-signing';
const imageFiles = {
  icon: ['app-icon-512.png'],
  featureGraphic: ['feature-graphic.jpg'],
  phoneScreenshots: ['phone-1-womens-rookie.png', 'phone-2-mens-pro.png'],
  sevenInchScreenshots: ['tablet-1-womens-rookie.png'],
  tenInchScreenshots: ['tablet-1-womens-rookie.png'],
};
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export function parseListing(markdown) {
  const extract = (label) => {
    const match = markdown.replaceAll('\r\n', '\n').match(new RegExp(`${label}:\\s*\\n\\s*\x60\x60\x60text\\n([\\s\\S]*?)\\n\x60\x60\x60`));
    assert(match, `Missing ${label} text block in docs/MOBILE-PLAY.md`);
    return match[1];
  };
  const listing = { language, title: 'PODIUM — BFT MENA', shortDescription: extract('Short description'), fullDescription: extract('Full description') };
  assert(listing.shortDescription === 'Live leaderboards, scores and results for the PODIUM BFT MENA series.', 'Short description differs from the release brief.');
  assert([...listing.title].length <= 30 && [...listing.shortDescription].length <= 80 && [...listing.fullDescription].length <= 4000, 'Listing exceeds Play text limits.');
  return listing;
}

export async function prepare({ assetsDir = join(signingDir, 'store-assets'), bundlePath = join(signingDir, 'app-release.aab') } = {}) {
  const listing = parseListing(await readFile(join(root, 'docs/MOBILE-PLAY.md'), 'utf8'));
  const images = {};
  const cache = new Map();
  for (const [type, names] of Object.entries(imageFiles)) {
    images[type] = [];
    for (const name of names) {
      if (!cache.has(name)) {
        const bytes = await readFile(join(assetsDir, name));
        const metadata = await sharp(bytes).metadata();
        assert(['png', 'jpeg'].includes(metadata.format), `${name}: only JPEG/PNG accepted.`);
        assert(bytes.length <= 8 * 1024 * 1024, `${name}: exceeds 8 MB.`);
        const expected = type === 'icon' ? [512, 512] : type === 'featureGraphic' ? [1024, 500] : name.startsWith('phone-') ? [1080, 1920] : [1920, 1080];
        // A portrait tablet replacement is allowed if Google rejects the original landscape.
        const portrait = name.startsWith('tablet-') && metadata.width === 2048 && metadata.height === 2732;
        assert(portrait || (metadata.width === expected[0] && metadata.height === expected[1]), `${name}: unexpected ${metadata.width}x${metadata.height}.`);
        if (type === 'icon') assert(bytes.length <= 1024 * 1024, `${name}: icon exceeds 1 MB.`);
        if (type !== 'icon') assert(!metadata.hasAlpha, `${name}: remove alpha before upload.`);
        // Decode the entire image as well as checking its header.
        await sharp(bytes).stats();
        cache.set(name, { name, bytes, sha256: hash(bytes), mime: metadata.format === 'png' ? 'image/png' : 'image/jpeg', width: metadata.width, height: metadata.height });
      }
      images[type].push(cache.get(name));
    }
  }
  const bytes = await readFile(bundlePath);
  assert(bytes.length > 0 && bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])), 'AAB is not a ZIP-format bundle.');
  // The version lives in the Gradle file — the same place the human bumps it —
  // so this script never hardcodes one and never publishes a stale build.
  const gradle = await readFile(join(root, 'android/app/build.gradle'), 'utf8');
  const versionCode = gradle.match(/versionCode\s+(\d+)/)?.[1];
  const versionName = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
  assert(versionCode && versionName, 'Cannot read versionCode/versionName from android/app/build.gradle.');
  return { version: { versionCode, versionName }, listing, images, bundle: { bytes, sha256: hash(bytes) } };
}

export async function createApi(keyPath) {
  const keyFile = await realpath(keyPath).catch(() => { throw new Error(`Service-account JSON missing at ${keyPath}. Follow docs/MOBILE-PLAY-API.md; no Play changes made.`); });
  const rel = relative(await realpath(root), keyFile);
  assert(rel.startsWith(`..\\`) || rel.startsWith('../') || isAbsolute(rel), 'Service-account JSON must be outside the repository.');
  let key;
  try { key = JSON.parse(await readFile(keyFile, 'utf8')); } catch { throw new Error('Service-account JSON is invalid (contents withheld).'); }
  assert(key.type === 'service_account' && key.client_email && key.private_key, 'Expected a service-account JSON with client_email and private_key.');
  const client = new JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
  const request = async (url, { method = 'GET', json, bytes, mime } = {}) => {
    assert(new URL(url).origin === 'https://androidpublisher.googleapis.com', 'Unexpected API origin.');
    let token;
    try { token = (await client.getAccessToken()).token; } catch { throw new Error('OAuth authentication failed. Check the service-account key, API enablement and system clock; credentials withheld.'); }
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(bytes ? { 'Content-Type': mime, 'Content-Length': String(bytes.length) } : {}) },
      body: bytes ?? (json !== undefined ? JSON.stringify(json) : undefined),
      signal: AbortSignal.timeout(bytes ? 300000 : 60000),
      redirect: 'error',
    });
    const text = await response.text();
    let result;
    try { result = text ? JSON.parse(text) : {}; } catch { throw new Error(`Play API returned non-JSON (HTTP ${response.status}).`); }
    if (!response.ok) {
      const error = new Error(`${method} ${new URL(url).pathname}: HTTP ${response.status}: ${result.error?.message || 'request rejected'}`);
      error.status = response.status;
      throw error;
    }
    return result;
  };
  return {
    create: () => request(base, { method: 'POST', json: {} }),
    call: (id, path = '', options) => request(`${base}/${encodeURIComponent(id)}${path}`, options),
    upload: (id, path, asset) => request(`${uploadBase}/${encodeURIComponent(id)}${path}?uploadType=media`, { method: 'POST', bytes: asset.bytes, mime: asset.mime || 'application/octet-stream' }),
  };
}

export async function verifySnapshot(api, id, prepared) {
  const listing = await api.call(id, `/listings/${language}`);
  for (const [field, value] of Object.entries(prepared.listing)) assert(listing[field] === value, `Verification failed: listing ${field}.`);
  const details = await api.call(id, '/details');
  assert(details.defaultLanguage === language, 'Verification failed: default language.');
  assert(details.contactEmail, 'Verification failed: contact email.');
  let count = 0;
  for (const [type, expected] of Object.entries(prepared.images)) {
    const actual = (await api.call(id, `/listings/${language}/${type}`)).images || [];
    assert(actual.length === expected.length, `Verification failed: ${type} image count.`);
    for (let i = 0; i < actual.length; i++) assert(actual[i].id && actual[i].sha256?.toLowerCase() === expected[i].sha256, `Verification failed: ${type} image ${i + 1} hash/order.`);
    count += actual.length;
  }
  const bundles = (await api.call(id, '/bundles')).bundles || [];
  assert(bundles.some((bundle) => String(bundle.versionCode) === prepared.version.versionCode && bundle.sha256?.toLowerCase() === prepared.bundle.sha256), `Verification failed: bundle versionCode ${prepared.version.versionCode} or hash.`);
  const track = await api.call(id, '/tracks/internal');
  assert(track.track === 'internal' && track.releases?.some((release) => release.status === 'completed' && release.name === `${prepared.version.versionCode} (${prepared.version.versionName})` && release.versionCodes?.map(String).includes(prepared.version.versionCode)), `Verification failed: completed internal release ${prepared.version.versionCode} (${prepared.version.versionName}).`);
  return count;
}

async function discard(api, id) {
  try { await api.call(id, '', { method: 'DELETE' }); }
  catch (error) { if (error.status !== 404) console.error(`Edit cleanup failed: ${error.message}`); }
}

export async function publish(api, prepared, { verifyOnly = false, log = console.log } = {}) {
  let editId;
  let committed = false;
  try {
    if (!verifyOnly) {
      editId = (await api.create()).id;
      assert(editId, 'Play returned no edit ID.');
      log('Edit created; preparing en-GB listing and internal release.');
      const bundles = (await api.call(editId, '/bundles')).bundles || [];
      const existing = bundles.find((bundle) => String(bundle.versionCode) === prepared.version.versionCode);
      if (existing) assert(existing.sha256?.toLowerCase() === prepared.bundle.sha256, `VersionCode ${prepared.version.versionCode} already exists with a different AAB. Refusing to replace it.`);
      else {
        const uploaded = await api.upload(editId, '/bundles', prepared.bundle);
        assert(String(uploaded.versionCode) === prepared.version.versionCode && uploaded.sha256?.toLowerCase() === prepared.bundle.sha256, 'Uploaded AAB is not the expected versionCode/hash. Edit will be discarded.');
      }
      const details = await api.call(editId, '/details');
      await api.call(editId, '/details', { method: 'PATCH', json: { defaultLanguage: language, ...(!details.contactEmail ? { contactEmail: supportEmail } : {}) } });
      await api.call(editId, `/listings/${language}`, { method: 'PATCH', json: prepared.listing });
      for (const [type, assets] of Object.entries(prepared.images)) {
        // There is no deleteexisting query flag: deleteall then upload within this edit.
        await api.call(editId, `/listings/${language}/${type}`, { method: 'DELETE' });
        for (const asset of assets) {
          const uploaded = await api.upload(editId, `/listings/${language}/${type}`, asset);
          assert(uploaded.image?.id, `${type} upload returned no image ID.`);
        }
        log(`${type}: ${assets.length} image(s) staged.`);
      }
      const internal = await api.call(editId, '/tracks/internal');
      // A completed release at or above the new code means a downgrade attempt;
      // lower codes are the normal upgrade path and are superseded by this PUT.
      const higher = (internal.releases || []).some((release) => (release.versionCodes || []).some((version) => Number(version) >= Number(prepared.version.versionCode)));
      assert(!higher, `Internal track already contains a versionCode at or above ${prepared.version.versionCode}; refusing to downgrade.`);
      await api.call(editId, '/tracks/internal', { method: 'PUT', json: { track: 'internal', releases: [{ name: `${prepared.version.versionCode} (${prepared.version.versionName})`, versionCodes: [prepared.version.versionCode], status: 'completed' }] } });
      await verifySnapshot(api, editId, prepared);
      await api.call(editId, ':validate', { method: 'POST' });
      try { await api.call(editId, ':commit', { method: 'POST' }); }
      catch (error) { throw new Error(`${error.message}\nCommit did not return success. If the response was lost, use --verify-only before retrying. No success checklist has been printed.`); }
      committed = true;
      editId = undefined;
      log('Edit committed. Checking persisted state in a fresh snapshot.');
    }
    // Listing/image/track GET methods all require editId. A new edit copies committed
    // state; never verify using the just-written draft or commit this read snapshot.
    editId = (await api.create()).id;
    assert(editId, 'Play returned no verification edit ID.');
    const count = await verifySnapshot(api, editId, prepared);
    log('[PASS] listing texts saved (exact en-GB title, short and full descriptions)');
    log(`[PASS] ${count} images ${verifyOnly ? 'verified' : 'uploaded'} (icon, feature graphic, phone, 7-inch, 10-inch)`);
    log(`[PASS] bundle versionCode ${prepared.version.versionCode} on internal track (completed, ${prepared.version.versionCode} (${prepared.version.versionName}))`);
    return count;
  } catch (error) {
    if (committed) log('Commit succeeded, but persisted-state verification failed; run --verify-only.');
    throw error;
  } finally { if (editId) await discard(api, editId); }
}

async function main() {
  const args = process.argv.slice(2);
  assert(args.every((arg) => ['--dry-run', '--verify-only'].includes(arg)), 'Usage: node scripts/play-publish.mjs [--dry-run | --verify-only]');
  assert(!(args.includes('--dry-run') && args.includes('--verify-only')), 'Choose dry-run or verify-only.');
  const prepared = await prepare({ assetsDir: process.env.PLAY_ASSETS_DIR, bundlePath: process.env.PLAY_BUNDLE_PATH });
  for (const [type, assets] of Object.entries(prepared.images)) for (const asset of assets) console.log(`${type}: ${asset.name} ${asset.width}x${asset.height}, ${asset.bytes.length} bytes`);
  if (args.includes('--dry-run')) { console.log('[PASS] local listing and assets valid; no authentication or API calls.'); return; }
  const api = await createApi(process.env.PLAY_SERVICE_ACCOUNT_JSON || join(signingDir, 'play-api-service-account.json'));
  // The user explicitly leaves the browser draft open. Never save/submit it:
  // this API edit is the source of truth and needs no browser interaction.
  await publish(api, prepared, { verifyOnly: args.includes('--verify-only') });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(`Play publish failed: ${error.message}`); process.exitCode = 1; });
}
