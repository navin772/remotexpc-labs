/**
 * 14 · Dark mode, text size, colour filters
 *
 * The practical use: the appearance matrix testers cover by hand. Flip the
 * device into dark mode and the largest Dynamic Type size, screenshot your
 * screens, flip it back — as part of the run rather than a manual pass.
 *
 *   node examples/14-appearance.mjs                     # read current settings
 *   node examples/14-appearance.mjs --style light
 *   node examples/14-appearance.mjs --text-size accessibilityExtraLarge --hold 8
 *
 * Whatever we change is restored before exit.
 */
import { Services } from 'appium-ios-remotexpc';

import { arg, check, heading, info, note, resolveUdid, run, step } from '../lib/lab.mjs';

const wantedStyle = arg('style', null);        // dark | light
const wantedSize = arg('text-size', null);     // extraSmall … accessibilityExtraExtraExtraLarge
const holdSeconds = Number(arg('hold', '6'));

await run(async () => {
  heading('14 · Appearance & accessibility', 'Dark mode and Dynamic Type, driven from a test');

  const udid = await resolveUdid();
  info('UDID', udid);

  step('Opening the configuration service');
  const config = await Services.startConfigurationService(udid);

  const original = {};
  const changed = [];

  try {
    step('Reading the current settings');
    original.style = await config.getUserInterfaceStyle();
    original.size = await config.getDeviceTextSize();
    original.filter = await config.getColorFilter();

    console.log();
    info('interface style', original.style);
    info('text size', original.size ?? '(not reported)');
    info('colour filter', JSON.stringify(original.filter));

    check('getUserInterfaceStyle() returned a style', Boolean(original.style), String(original.style));
    check('getColorFilter() returned state', original.filter !== undefined);

    if (!wantedStyle && !wantedSize) {
      console.log();
      note('Nothing changed. Re-run with --style light or --text-size accessibilityExtraLarge');
      note('to see the device actually switch.');
      return;
    }

    console.log();
    if (wantedStyle) {
      step(`Switching interface style to ${wantedStyle}`);
      await config.setUserInterfaceStyle(wantedStyle);
      changed.push('style');
      const now = await config.getUserInterfaceStyle();
      check(`interface style is now ${wantedStyle}`, String(now) === wantedStyle, String(now));
    }

    if (wantedSize) {
      step(`Setting text size to ${wantedSize}`);
      await config.setDeviceTextSize(wantedSize);
      changed.push('size');
      const now = await config.getDeviceTextSize();
      check(`text size is now ${wantedSize}`, String(now) === wantedSize, String(now));
    }

    note('Look at the device — take your screenshots here (example 09).');
    step(`Holding for ${holdSeconds}s`);
    await new Promise((resolve) => setTimeout(resolve, holdSeconds * 1000));
  } finally {
    if (changed.includes('style') && original.style) {
      step(`Restoring interface style to ${original.style}`);
      await config.setUserInterfaceStyle(original.style);
      check('interface style restored', true, String(original.style));
    }
    if (changed.includes('size') && original.size) {
      step(`Restoring text size to ${original.size}`);
      await config.setDeviceTextSize(original.size);
      check('text size restored', true, String(original.size));
    }
    await config.close?.();
  }

  console.log();
  note('Text sizes: extraSmall, small, medium, large, extraLarge, extraExtraLarge,');
  note('extraExtraExtraLarge, plus the accessibility* sizes.');
  note('Pair this with example 09 to capture the same screen in every combination');
  note('without touching the device.');
});
