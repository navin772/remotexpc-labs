/**
 * 10 · Crash reports
 *
 * The practical use: when a test fails because the app died, ship the crash
 * report with the failure instead of a screenshot of nothing.
 *
 *   node examples/10-crash-reports.mjs
 *   node examples/10-crash-reports.mjs --pull ./artifacts/crashes
 *
 * Listing is read-only. Pulling copies files to your machine. Clearing the
 * device's crash store is shown but not run — see the note at the end.
 */
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Services } from 'appium-ios-remotexpc';

import { arg, check, heading, info, note, resolveUdid, run, step } from '../lib/lab.mjs';

const pullTo = arg('pull', null);

await run(async () => {
  heading('10 · Crash reports', 'Evidence collection over the network');

  const udid = await resolveUdid();
  info('UDID', udid);

  step('Opening the crash reports service');
  const crashes = await Services.startCrashReportsService(udid);

  step('Listing the crash report directory');
  const entries = await crashes.ls('/', 1);

  check('ls() returned a listing', Array.isArray(entries), `${entries.length} entr(ies)`);

  const reports = entries.filter((name) => /\.(ips|crash|panic|synced)$/i.test(name));
  console.log();
  info('total entries', entries.length);
  info('report-like files', reports.length);

  console.log();
  for (const name of entries.slice(0, 12)) {
    console.log(`  ${name}`);
  }
  if (entries.length > 12) {
    note(`… and ${entries.length - 12} more`);
  }

  if (entries.length === 0) {
    note('Nothing here — this device has no stored crash reports, which is good');
    note('news for the device and mildly disappointing for the demo.');
  }

  if (pullTo) {
    const dest = resolve(pullTo);
    console.log();
    step(`Pulling reports to ${dest}`);
    await crashes.pull(dest);
    const pulled = await readdir(dest).catch(() => []);
    info('files on disk', pulled.length);
    check('pull() wrote files locally', pulled.length > 0, `${pulled.length} file(s)`);
  } else {
    console.log();
    note('Re-run with --pull ./artifacts/crashes to copy them to this machine.');
  }

  console.log();
  note('Also available, not run here:');
  note('  await crashes.clear()   // empties the device crash store');
  note('  await crashes.flush()   // triggers a sysdiagnose archive');
  note('clear() matters on shared devices: without it, old reports get attached');
  note('to the wrong test run. Pull first, then clear.');
});
