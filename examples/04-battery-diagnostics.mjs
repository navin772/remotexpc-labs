/**
 * 04 · Battery and power state
 *
 * The practical use: gate a long suite on battery level. A two-hour regression
 * that starts at 12% will fail somewhere in the middle and blame your tests.
 *
 *   node examples/04-battery-diagnostics.mjs
 *   node examples/04-battery-diagnostics.mjs --min 20
 */
import { Services } from 'appium-ios-remotexpc';

import { arg, check, heading, info, note, resolveUdid, run, step } from '../lib/lab.mjs';

const minBattery = Number(arg('min', '15'));

await run(async () => {
  heading('04 · Battery diagnostics', 'Decide whether this device is fit to run a suite');

  const udid = await resolveUdid();
  info('UDID', udid);

  step('Opening the diagnostics service');
  const diagnostics = await Services.startDiagnosticsService(udid);

  // IOPMPowerSource is the IORegistry class that holds battery state.
  step("Querying IORegistry for 'IOPMPowerSource'");
  const power = await diagnostics.ioregistry({
    ioClass: 'IOPMPowerSource',
    returnRawJson: true,
  });

  check('ioregistry() returned a power source', Boolean(power) && typeof power === 'object');

  const level = power.CurrentCapacity;
  const charging = power.ExternalConnected;

  console.log();
  info('BatteryInstalled', String(power.BatteryInstalled));
  info('CurrentCapacity', level === undefined ? '(n/a)' : `${level}%`);
  info('ExternalConnected', String(charging));
  if (power.Temperature !== undefined) {
    // Reported in centi-degrees Celsius.
    info('Temperature', `${(power.Temperature / 100).toFixed(1)} °C`);
  }
  if (power.CycleCount !== undefined) {
    info('CycleCount', power.CycleCount);
  }

  console.log();
  check('a battery is installed', power.BatteryInstalled === true);
  check('battery level is readable', typeof level === 'number', `${level}%`);
  check(
    `battery is above the ${minBattery}% floor for a long run`,
    typeof level === 'number' && level >= minBattery,
    `${level}% vs ${minBattery}%`,
  );

  if (charging) {
    note('Device is on external power — safe for a long suite regardless of level.');
  } else {
    note('Device is on battery. Keep it on power for long runs; a sleeping device');
    note('drops its tunnel.');
  }

  note('In a real harness this is a precondition, not a test: skip the run rather');
  note('than collect a false failure at minute 90.');
});
