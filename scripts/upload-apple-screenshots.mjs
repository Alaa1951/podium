/** Reserve, upload and commit the captured PNGs. Does not submit for review. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { asc, appId } from './asc-api.mjs';

const directory = resolve(process.argv[2] || 'build/store-screenshots');
const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
const versions = (await asc(`/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&filter[versionString]=1.0`)).data;
const version = versions.find(v => v.attributes.appVersionState === 'PREPARE_FOR_SUBMISSION');
if (!version) throw new Error('Editable iOS 1.0 version is required.');
const localization = (await asc(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`)).data.find(l => l.attributes.locale === 'en-GB');
if (!localization) throw new Error('English (U.K.) localization is missing.');
const sets = (await asc(`/v1/appStoreVersionLocalizations/${localization.id}/appScreenshotSets`)).data;
const displaySizes = { APP_IPHONE_65: [1242, 2688], APP_IPAD_PRO_3GEN_129: [2048, 2732] };
for (const display of Object.keys(displaySizes)) {
  const items = manifest.filter(m => m.display === display).sort((a, b) => a.order - b.order);
  if (items.length !== 2) throw new Error(`Expected two screenshots for ${display}.`);
  let set = sets.find(s => s.attributes.screenshotDisplayType === display);
  if (!set) set = (await asc('/v1/appScreenshotSets', { method: 'POST', data: {
    type: 'appScreenshotSets', attributes: { screenshotDisplayType: display },
    relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: localization.id } } },
  } })).data;
  const existing = (await asc(`/v1/appScreenshotSets/${set.id}/appScreenshots`)).data;
  const ordered = [];
  for (const item of items) {
    if (basename(item.fileName) !== item.fileName || !item.fileName.endsWith('.png')) throw new Error('PNG filename without directories required.');
    const bytes = await readFile(join(directory, item.fileName));
    const [width, height] = displaySizes[display];
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height) throw new Error(`Invalid PNG dimensions: ${item.fileName}`);
    const checksum = createHash('md5').update(bytes).digest('hex');
    let screenshot = existing.find(s => s.attributes.fileName === item.fileName);
    if (screenshot && screenshot.attributes.sourceFileChecksum !== checksum) {
      throw new Error(`Existing screenshot differs; review before replacing ${item.fileName}.`);
    }
    if (!screenshot) {
      screenshot = (await asc('/v1/appScreenshots', { method: 'POST', data: {
        type: 'appScreenshots', attributes: { fileName: item.fileName, fileSize: bytes.length },
        relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } },
      } })).data;
      for (const operation of screenshot.attributes.uploadOperations) {
        if (new URL(operation.url).protocol !== 'https:') throw new Error('HTTPS upload required.');
        const headers = Object.fromEntries(operation.requestHeaders.map(h => [h.name, h.value]));
        const response = await fetch(operation.url, {
          method: operation.method, headers,
          body: bytes.subarray(operation.offset, operation.offset + operation.length),
          signal: AbortSignal.timeout(60000),
        });
        if (!response.ok) throw new Error(`Asset upload failed: ${response.status}`);
      }
      screenshot = (await asc(`/v1/appScreenshots/${screenshot.id}`, { method: 'PATCH', data: {
        type: 'appScreenshots', id: screenshot.id, attributes: { uploaded: true, sourceFileChecksum: checksum },
      } })).data;
    }
    ordered.push({ type: 'appScreenshots', id: screenshot.id });
    for (let attempt = 0; attempt < 15; attempt++) {
      screenshot = (await asc(`/v1/appScreenshots/${screenshot.id}`)).data;
      const state = screenshot.attributes.assetDeliveryState?.state;
      console.log(item.fileName, screenshot.id, state);
      if (state === 'COMPLETE') break;
      if (state === 'FAILED' || attempt === 14) throw new Error(`Screenshot delivery: ${JSON.stringify(screenshot.attributes.assetDeliveryState)}`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  // Preserve any pre-existing screenshots after the newly requested leaderboard pair.
  ordered.push(...existing.filter(s => !ordered.some(o => o.id === s.id)).map(s => ({ type: 'appScreenshots', id: s.id })));
  await asc(`/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, { method: 'PATCH', data: ordered });
  console.log('ORDER VERIFIED', display, (await asc(`/v1/appScreenshotSets/${set.id}/appScreenshots`)).data.map(s => s.attributes.fileName));
}
