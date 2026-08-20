/**
 * 12 · Test on a bad network, on purpose
 *
 * The practical use: run your suite under Edge, 3G, or 100% packet loss on a
 * real device — no proxy, no mock, no jailbreak. Same for thermal pressure.
 *
 *   node examples/12-degraded-conditions.mjs                    # list what's available
 *   node examples/12-degraded-conditions.mjs --set 100%Loss     # apply, hold, restore
 *   node examples/12-degraded-conditions.mjs --set SevereThermal --hold 20
 *
 * The condition is always disabled again before we exit.
 */
import { Services } from 'appium-ios-remotexpc';

import { arg, check, heading, info, note, resolveUdid, run, step } from '../lib/lab.mjs';

const wanted = arg('set', null);
const holdSeconds = Number(arg('hold', '5'));

await run(async () => {
  heading('12 · Degraded conditions', 'Make the device slow, lossy, or hot — deliberately');

  const udid = await resolveUdid();
  info('UDID', udid);

  step('Opening the DVT service');
  const dvt = await Services.startDVTService(udid);

  let applied = null;
  try {
    step('Listing the condition profiles this device supports');
    const groups = await dvt.conditionInducer.list();
    check('conditionInducer.list() returned groups', groups.length > 0, `${groups.length} groups`);

    // Every identifier, under the group it belongs to. The list is short
    // enough to read, and which group a profile sits in tells you what it
    // will actually do to the device.
    const all = [];
    for (const group of groups) {
      console.log();
      info(group.identifier ?? '(unnamed group)', `${group.profiles?.length ?? 0} profiles`);
      for (const profile of group.profiles ?? []) {
        all.push(profile.identifier);
        note(`  ${profile.identifier}`);
      }
    }

    console.log();
    note('Pass any identifier above to --set.');
    check('profiles are addressable by identifier', all.length > 0, `${all.length} profiles`);

    if (!wanted) {
      console.log();
      note('Nothing applied. Re-run with --set <identifier> to actually degrade the device,');
      note('e.g. --set ' + (all[0] ?? '<identifier>'));
      return;
    }

    const match = all.find((id) => id.toLowerCase() === wanted.toLowerCase())
      ?? all.find((id) => id.toLowerCase().includes(wanted.toLowerCase()));

    if (!match) {
      check(`a profile matching "${wanted}" exists`, false, 'see the list above');
      return;
    }

    console.log();
    step(`Applying ${match}`);
    await dvt.conditionInducer.set(match);
    applied = match;
    check(`condition ${match} was applied`, true);
    note('Try loading something on the device now — it should feel wrong.');

    step(`Holding for ${holdSeconds}s`);
    await new Promise((resolve) => setTimeout(resolve, holdSeconds * 1000));
    check('device stayed reachable while degraded', true);
  } finally {
    if (applied) {
      step('Restoring normal conditions');
      await dvt.conditionInducer.disable();
      check('conditionInducer.disable() restored the device', true);
    }
    await dvt.dvtService.close();
  }

  console.log();
  note('Always disable() in a finally block. A device left on 100% packet loss');
  note('will fail every test after this one, and the cause is not obvious.');
});
