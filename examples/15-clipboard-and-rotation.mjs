/**
 * 15 · Clipboard and rotation
 *
 * Two small device controls that remove manual steps from a test: put text on
 * the device's pasteboard so a paste flow has something to paste, and rotate
 * the device to check your landscape layout.
 *
 *   node examples/15-clipboard-and-rotation.mjs
 *   node examples/15-clipboard-and-rotation.mjs --text "order-12345"
 *   node examples/15-clipboard-and-rotation.mjs --no-rotate
 */
import { Services } from 'appium-ios-remotexpc';

import { arg, check, flag, heading, info, note, resolveUdid, run, step } from '../lib/lab.mjs';

const text = arg('text', `remotexpc-labs ${new Date().toISOString().slice(11, 19)}`);
const skipRotate = flag('no-rotate');

await run(async () => {
  heading('15 · Clipboard and rotation', 'Small controls, fewer manual steps');

  const udid = await resolveUdid();
  info('UDID', udid);

  // --- Pasteboard ------------------------------------------------------
  step('Opening the pasteboard service');
  const pasteboard = await Services.startPasteboardService(udid);

  try {
    const before = await pasteboard.getText();
    info('clipboard before', before === undefined ? '(empty)' : `${String(before).slice(0, 40)}`);

    step(`Writing ${JSON.stringify(text)} to the device clipboard`);
    await pasteboard.setText(text);

    const after = await pasteboard.getText();
    info('clipboard after', String(after));
    check('setText() then getText() round-tripped', String(after) === text);
    note('Long-press any text field on the device and Paste to see it.');
  } finally {
    await pasteboard.close?.();
  }

  // --- Rotation --------------------------------------------------------
  if (skipRotate) {
    console.log();
    note('Rotation skipped (--no-rotate).');
    return;
  }

  console.log();
  step('Opening the device control service');
  const control = await Services.startDeviceControlService(udid);

  try {
    const left = await control.rotate('left');
    info('after rotate left', left?.currentDeviceOrientation ?? JSON.stringify(left).slice(0, 60));
    check('rotate("left") returned an orientation state', Boolean(left));

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const right = await control.rotate('right');
    info('after rotate right', right?.currentDeviceOrientation ?? JSON.stringify(right).slice(0, 60));
    check('rotate("right") returned the device', Boolean(right));
  } finally {
    await control.close?.();
  }

  console.log();
  note('Rotation is relative, not absolute: rotate() turns the device one step in');
  note('the given direction. Rotate back the same number of steps you rotated out.');
  note('getImage()/setImage() do the same job as getText()/setText() for images.');
});
