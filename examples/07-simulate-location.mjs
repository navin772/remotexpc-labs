/**
 * 07 · Put the device somewhere else
 *
 * The practical use: geofence and region tests on a real device, with no mock
 * location layer in your app and no jailbreak.
 *
 *   node examples/07-simulate-location.mjs
 *   node examples/07-simulate-location.mjs --lat 48.8584 --lon 2.2945 --hold 20
 *
 * To see it: open Maps on the device before running, and watch the blue dot.
 * GPS must be enabled for the change to be visible.
 *
 * The simulated location is always cleared before we exit.
 */
import { Services } from 'appium-ios-remotexpc';

import { arg, check, heading, info, note, resolveUdid, run, step } from '../lib/lab.mjs';

// Apple Park.
const lat = Number(arg('lat', '37.334606'));
const lon = Number(arg('lon', '-122.009102'));
const holdSeconds = Number(arg('hold', '10'));

await run(async () => {
  heading('07 · Simulate location', 'Move a real device without moving it');

  const udid = await resolveUdid();
  info('UDID', udid);
  info('target', `${lat}, ${lon}`);
  info('hold', `${holdSeconds}s`);

  step('Opening the DVT service');
  const dvt = await Services.startDVTService(udid);

  let didSet = false;
  try {
    step('Setting the simulated location');
    await dvt.locationSimulation.set({ latitude: lat, longitude: lon });
    didSet = true;
    check('locationSimulation.set() was accepted', true, `${lat}, ${lon}`);

    note('Check Maps on the device now.');
    step(`Holding for ${holdSeconds}s`);
    await new Promise((resolve) => setTimeout(resolve, holdSeconds * 1000));
    check('device held the simulated location without erroring', true);
  } finally {
    if (didSet) {
      step('Clearing the simulated location');
      await dvt.locationSimulation.clear();
      check('locationSimulation.clear() restored real GPS', true);
    }
    await dvt.dvtService.close();
  }

  console.log();
  note('Always clear() in a finally block. A device left in a simulated location');
  note('will quietly break the next test that cares where it is.');
});
