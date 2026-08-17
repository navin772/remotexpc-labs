/**
 * 03 · What is this device?
 *
 * CoreDevice DeviceInfo is the same backend `xcrun devicectl` uses. Handy in a
 * test harness for recording what you actually ran against.
 *
 *   node examples/03-device-info.mjs
 *
 * Note: not every CoreDevice action exists on every iOS version. This example
 * treats the optional ones as optional instead of failing — worth copying into
 * your own code.
 */
import { Services } from 'appium-ios-remotexpc';

import { check, heading, info, note, resolveUdid, run, step } from '../lib/lab.mjs';

const gb = (bytes) => `${(bytes / 1e9).toFixed(1)} GB`;

await run(async () => {
  heading('03 · Device info', 'Identity and state, straight off the device');

  const udid = await resolveUdid();
  info('UDID', udid);

  step('Opening the CoreDevice DeviceInfo service');
  const deviceInfo = await Services.startCoreDeviceInfoService(udid);

  try {
    const attrs = await deviceInfo.getDeviceInfo();
    console.log();
    info('remoteServicesVersion', attrs.remoteServicesVersion ?? '(n/a)');
    info('logical cores', attrs.cpuCount?.logicalCores ?? '(n/a)');
    info('physical cores', attrs.cpuCount?.physicalCores ?? '(n/a)');
    info('storage capacity', attrs.internalStorageCapacity ? gb(attrs.internalStorageCapacity) : '(n/a)');
    info('supports Siri', String(attrs.supportsSiri ?? '(n/a)'));
    info('has action button', String(attrs.hasActionButton ?? '(n/a)'));

    check('getDeviceInfo() returned attributes', Object.keys(attrs).length > 0, `${Object.keys(attrs).length} fields`);
    check('CPU topology is reported', Boolean(attrs.cpuCount?.logicalCores));

    const display = await deviceInfo.getDisplayInfo();
    const displays = Array.isArray(display.displays) ? display.displays : [];
    console.log();
    info('displays', displays.length);
    info('orientation', display.orientation?.currentDeviceOrientation ?? '(n/a)');
    info('orientation locked', String(display.orientation?.currentDeviceOrientationLocked ?? '(n/a)'));
    for (const d of displays) {
      info('  display', `${d.deviceName ?? 'unnamed'} ${d.primary ? '(primary)' : ''}${d.external ? ' (external)' : ''}`);
    }
    check('getDisplayInfo() reported at least one display', displays.length > 0);

    // Optional: several CoreDevice actions are version dependent.
    console.log();
    step('Trying the optional actions');
    for (const [label, call] of [
      ['getLockState()', () => deviceInfo.getLockState()],
      ['queryMobileGestalt()', () => deviceInfo.queryMobileGestalt(['ProductType', 'ProductVersion'])],
    ]) {
      try {
        const value = await call();
        check(`${label} is available`, true, JSON.stringify(value).slice(0, 60));
      } catch (err) {
        note(`${label} not available on this device — ${String(err.message).split('[')[0].trim()}`);
      }
    }
    note('Version-dependent actions like these should always be wrapped.');
  } finally {
    await deviceInfo.close();
  }
});
