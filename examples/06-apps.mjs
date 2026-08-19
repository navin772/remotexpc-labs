/**
 * 06 · What's installed, and launch something
 *
 * The practical use: deterministic app state between tests, and doing it to a
 * device that is nowhere near you.
 *
 *   node examples/06-apps.mjs
 *   node examples/06-apps.mjs --launch com.apple.Preferences
 *
 * Read-only by default. Installing and uninstalling are one call each (shown at
 * the bottom) but we are not going to mutate your device to prove a point.
 *
 * Two services appear here because they do different jobs:
 *   installation proxy → the app inventory
 *   DVT process control → starting and stopping processes
 */
import { Services } from 'appium-ios-remotexpc';

import { arg, check, heading, info, note, resolveUdid, run, step } from '../lib/lab.mjs';

const launchBundleId = arg('launch', null);

await run(async () => {
  heading('06 · Apps', 'List installed apps, then launch one');

  const udid = await resolveUdid();
  info('UDID', udid);

  step('Opening the installation proxy');
  const installProxy = await Services.startInstallationProxyService(udid);

  step('Browsing user-installed apps');
  const userApps = await installProxy.browse({ applicationType: 'User' });
  check('browse() returned user apps', Array.isArray(userApps), `${userApps.length} app(s)`);

  console.log();
  for (const app of userApps.slice(0, 8)) {
    const id = app.CFBundleIdentifier ?? app.bundleIdentifier ?? '(no id)';
    const name = app.CFBundleDisplayName ?? app.CFBundleName ?? app.name ?? '';
    const version = app.CFBundleShortVersionString ?? app.version ?? '';
    info((name || id).slice(0, 20), `${id}${version ? ` · ${version}` : ''}`);
  }
  if (userApps.length > 8) {
    note(`… and ${userApps.length - 8} more`);
  }

  // lookup() is the targeted version: ask about specific bundle ids.
  console.log();
  step('Looking up a system app by bundle id');
  const found = await installProxy.lookup(['com.apple.Preferences']);
  const prefs = found['com.apple.Preferences'];
  check('lookup() found com.apple.Preferences', Boolean(prefs));
  if (prefs) {
    info('name', prefs.CFBundleDisplayName ?? prefs.CFBundleName ?? '(unnamed)');
    info('version', prefs.CFBundleShortVersionString ?? '(n/a)');
  }

  // Launching goes through the DVT process control instrument.
  console.log();
  step('Opening the DVT service for process control');
  const dvt = await Services.startDVTService(udid);

  try {
    const target = launchBundleId ?? 'com.apple.Preferences';
    step(`Launching ${target}`);
    const pid = await dvt.processControl.launch({ bundleId: target, killExisting: true });
    info('pid', pid);
    check(`launched ${target}`, typeof pid === 'number' && pid > 0, `pid ${pid}`);

    const confirmed = await dvt.processControl.getPidForBundleIdentifier(target);
    check('the process is running on the device', confirmed === pid, `pid ${confirmed}`);
    note('Look at the device — it should be on screen now.');
  } finally {
    await dvt.dvtService.close();
  }

  console.log();
  note('Not run here, but one call each:');
  note("  await (await Services.startZipConduitService(udid)).install('./MyApp.ipa')");
  note("  await installProxy.uninstall('com.example.app')");
  note('That pair is the most reliable way to reset app state between tests.');
  console.log();
  note('Caveat worth knowing: the newer CoreDevice app service');
  note('(Services.startAppService) also lists and launches apps, but its');
  note('listApps/launchApplication time out on some iOS builds — including the');
  note('one we tested on. DVT process control is the dependable path today.');
});
