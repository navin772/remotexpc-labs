/**
 * 09 · Grab a screenshot
 *
 * The practical use: attach the screen state to a failing test, captured over
 * the network with nobody in the room.
 *
 *   node examples/09-screenshot.mjs
 *   node examples/09-screenshot.mjs --out ./artifacts/before-checkout.png
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { Services } from 'appium-ios-remotexpc';

import { arg, check, heading, info, note, resolveUdid, run, step } from '../lib/lab.mjs';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outPath = resolve(arg('out', `./artifacts/screenshot-${stamp}.png`));

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

await run(async () => {
  heading('09 · Screenshot', 'Capture the screen through the tunnel');

  const udid = await resolveUdid();
  info('UDID', udid);

  step('Opening the DVT service');
  const dvt = await Services.startDVTService(udid);

  let image;
  try {
    step('Requesting a screenshot');
    image = await dvt.screenshot.getScreenshot();
  } finally {
    await dvt.dvtService.close();
  }

  check('getScreenshot() returned data', Buffer.isBuffer(image) && image.length > 0, `${image?.length ?? 0} bytes`);
  check('the data is a PNG', image.subarray(0, 4).equals(PNG_MAGIC), image.subarray(1, 4).toString());

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, image);

  console.log();
  info('saved to', outPath);
  info('size', `${(image.length / 1024).toFixed(0)} KB`);
  check('the file was written', true);

  console.log();
  note('Open it to confirm it shows the device screen:');
  note(`  open "${outPath}"`);
  note('In a harness, call this in your afterEach when the test failed.');
});
