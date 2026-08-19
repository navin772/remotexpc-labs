/**
 * 11 · AFC — the file conduit
 *
 * The practical use: push a fixture onto the device or pull an artifact off
 * it, without touching an app's own sandbox. This is the same conduit Finder
 * and iTunes file sharing ride on — it sees the device's shared media
 * partition, not the whole filesystem.
 *
 *   node examples/11-afc.mjs
 *   node examples/11-afc.mjs --push ./some-file.txt
 *
 * Tours the root directory read-only, then does one reversible round trip:
 * make a scratch directory, push a file into it, read it back two ways
 * (getFileContents and a pulled local copy), and remove the directory again
 * (add --keep to leave it on the device).
 */
import { createHash } from 'node:crypto';
import { mkdir as mkdirLocal, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { Services } from 'appium-ios-remotexpc';

import { arg, check, flag, heading, info, note, resolveUdid, run, step } from '../lib/lab.mjs';

const pushArg = arg('push', null);
const keep = flag('keep');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const scratchDir = '/remotexpc-labs-scratch';

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

await run(async () => {
  heading('11 · AFC', 'The file conduit — root tour, then a push/pull round trip');

  const udid = await resolveUdid();
  info('UDID', udid);

  step('Opening the AFC service');
  const afc = await Services.startAfcService(udid);

  try {
    step("Listing the root directory ('/')");
    const rootEntries = await afc.listdir('/');
    check('listdir() returned the root', Array.isArray(rootEntries), `${rootEntries.length} entr(y/ies)`);
    for (const name of rootEntries.slice(0, 8)) {
      info(name, '');
    }
    if (rootEntries.length > 8) {
      note(`… and ${rootEntries.length - 8} more`);
    }

    console.log();
    step('Stating the first root entry');
    const firstName = rootEntries[0];
    const firstPath = `/${firstName}`;
    const stat = await afc.stat(firstPath);
    check('stat() returned info', Boolean(stat), firstPath);
    info('type', stat.st_ifmt);
    info('size', `${stat.st_size} byte(s)`);
    info('mtime', stat.st_mtime?.toISOString?.() ?? String(stat.st_mtime));

    console.log();
    step('Checking exists() for a real path and a made-up one');
    check('the root entry is reported to exist', await afc.exists(firstPath));
    check('a made-up path is reported not to exist', !(await afc.exists('/definitely-not-here-12345')));

    // Local source file: either one you pass with --push, or a small one we
    // generate so the round trip works with nothing on hand.
    let localSrc;
    if (pushArg) {
      localSrc = resolve(pushArg);
    } else {
      localSrc = resolve('./artifacts', `afc-sample-${stamp}.txt`);
      await mkdirLocal('artifacts', { recursive: true });
      await writeFile(localSrc, `remotexpc-labs AFC round trip\ngenerated ${new Date().toISOString()}\n`);
    }
    const localBytes = await readFile(localSrc);
    const remoteName = basename(localSrc);
    const remotePath = `${scratchDir}/${remoteName}`;

    console.log();
    step(`Creating scratch directory ${scratchDir}`);
    await afc.mkdir(scratchDir);
    check('mkdir() succeeded (and is idempotent)', await afc.exists(scratchDir));

    console.log();
    step(`Pushing ${localSrc} → ${remotePath}`);
    try {
      await afc.push(localSrc, remotePath);
      check('the file exists on the device after push()', await afc.exists(remotePath));

      const remoteBytes = await afc.getFileContents(remotePath);
      check('getFileContents() matches what we pushed', sha256(remoteBytes) === sha256(localBytes), `${remoteBytes.length} byte(s)`);

      console.log();
      const pulledPath = resolve('./artifacts', `afc-pulled-${stamp}-${remoteName}`);
      step(`Pulling it back → ${pulledPath}`);
      await afc.pull(remotePath, pulledPath);
      const pulledBytes = await readFile(pulledPath);
      check('the pulled copy matches too', sha256(pulledBytes) === sha256(localBytes));
      info('saved to', pulledPath);
    } finally {
      if (!keep) {
        console.log();
        step(`Removing ${scratchDir}`);
        await afc.rm(scratchDir, true);
        check('the scratch directory is gone', !(await afc.exists(scratchDir)));
      } else {
        note(`--keep set: leaving ${scratchDir} on the device.`);
      }
    }
  } finally {
    afc.close();
  }

  console.log();
  note('AFC only sees the media partition (Downloads, DCIM, Books, and');
  note("whatever apps expose via iTunes file sharing) — not an app's own");
  note('sandbox. For that, use the house arrest service instead.');
});
