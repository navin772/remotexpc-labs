/**
 * 01 · Which devices can this host see?
 *
 * usbmuxd lists devices attached over USB *and* over WiFi. The only difference
 * is the ConnectionType on the row: 'USB' or 'Network'. Same UDID either way,
 * and everything after this point is identical.
 *
 *   node examples/01-list-devices.mjs
 *
 * No tunnel is needed for this one — it is the step before the tunnel exists.
 */
import { createUsbmux } from 'appium-ios-remotexpc';

import { check, heading, info, note, run, step } from '../lib/lab.mjs';

await run(async () => {
  heading('01 · List devices', 'usbmuxd sees USB and WiFi devices in one list');

  step('Connecting to usbmuxd');
  const usbmux = await createUsbmux();

  try {
    const devices = await usbmux.listDevices();
    step(`usbmuxd returned ${devices.length} device row(s)`);
    console.log();

    for (const device of devices) {
      const props = device.Properties ?? {};
      info('UDID', props.SerialNumber ?? '(unknown)');
      info('DeviceID', device.DeviceID);
      info('ConnectionType', props.ConnectionType ?? '(unknown)');
      if (props.ProductID) {
        info('ProductID', props.ProductID);
      }
      console.log();
    }

    const types = devices.map((d) => d.Properties?.ConnectionType).filter(Boolean);
    const udids = new Set(devices.map((d) => d.Properties?.SerialNumber).filter(Boolean));

    check('usbmuxd is reachable', true);
    check('at least one device is listed', devices.length > 0, `${devices.length} row(s)`);
    check(
      'every row carries a UDID and a ConnectionType',
      devices.length > 0 && types.length === devices.length && udids.size > 0,
    );

    if (types.includes('Network')) {
      check("a WiFi row is present (ConnectionType: 'Network')", true);
      note('This device is reachable with no cable attached.');
    } else {
      note("No 'Network' row yet — this device is listed over USB only.");
      note('To add one: pair over USB, then enable "Show this device when on WiFi"');
      note('in Finder (or "Connect via network" in Xcode → Devices and Simulators).');
      note('Everything in the later examples works over USB too.');
    }

    if (udids.size < devices.length) {
      note('A UDID appearing twice means the same phone is listed over both transports.');
    }
  } finally {
    await usbmux.close();
  }
});
