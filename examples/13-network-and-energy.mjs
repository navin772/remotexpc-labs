/**
 * 13 · Network and energy, per process
 *
 * The practical use: catch the regression where a release starts chattering on
 * the network or burning battery, on the device, as part of a test run.
 *
 *   node examples/13-network-and-energy.mjs
 *   node examples/13-network-and-energy.mjs --events 10 --bundle com.apple.Preferences
 */
import { Services } from 'appium-ios-remotexpc';

import { arg, check, heading, info, note, resolveUdid, run, step } from '../lib/lab.mjs';

const wantedEvents = Number(arg('events', '5'));
const bundleId = arg('bundle', 'com.apple.Preferences');

await run(async () => {
  heading('13 · Network and energy', 'Two more instruments off the same DVT connection');

  const udid = await resolveUdid();
  info('UDID', udid);

  step('Opening the DVT service');
  const dvt = await Services.startDVTService(udid);

  try {
    // --- Network -------------------------------------------------------
    step(`Collecting up to ${wantedEvents} network events`);
    await dvt.networkMonitor.start();

    const events = [];
    const iterator = dvt.networkMonitor.events();
    const stopAfter = setTimeout(() => iterator.return?.(), 15000);
    for await (const event of iterator) {
      events.push(event);
      if (events.length >= wantedEvents) {
        break;
      }
    }
    clearTimeout(stopAfter);
    await dvt.networkMonitor.stop();

    check('networkMonitor produced events', events.length > 0, `${events.length} event(s)`);
    console.log();
    for (const event of events.slice(0, 6)) {
      const kind = event?.type ?? event?.kind ?? 'event';
      console.log(`  ${String(kind).slice(0, 18).padEnd(18)} ${JSON.stringify(event).slice(0, 96)}`);
    }

    // --- Energy --------------------------------------------------------
    console.log();
    step(`Sampling energy for ${bundleId}`);
    let pid = null;
    try {
      pid = await dvt.processControl.getPidForBundleIdentifier(bundleId);
    } catch {
      note(`${bundleId} is not running — launch it first (example 06 --launch ${bundleId}).`);
    }

    if (pid) {
      info('pid', pid);
      await dvt.energyMonitor.startSampling([pid]);
      const sample = await dvt.energyMonitor.sample([pid]);
      await dvt.energyMonitor.stopSampling([pid]);

      const forPid = sample?.[pid] ?? sample?.[String(pid)] ?? sample;
      const keys = Object.keys(forPid ?? {});
      check('energyMonitor returned a sample', keys.length > 0, `${keys.length} metrics`);
      console.log();
      for (const key of keys.slice(0, 8)) {
        info(key.replace('kIDEGauge', '').slice(0, 20), String(forPid[key]).slice(0, 40));
      }
    }
  } finally {
    await dvt.dvtService.close();
  }

  console.log();
  note('Both instruments share the one DVT connection you already opened, so this');
  note('costs no extra setup in a real harness.');
});
