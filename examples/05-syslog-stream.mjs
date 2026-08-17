/**
 * 05 · Stream the device log
 *
 * The practical use: capture the device log around a failing test and attach it
 * to the report, instead of asking a developer to reproduce it with Xcode
 * attached.
 *
 *   node examples/05-syslog-stream.mjs
 *   node examples/05-syslog-stream.mjs --seconds 15
 *   node examples/05-syslog-stream.mjs --match Springboard
 *
 * Tip: unlock the device and swipe around while this runs — you'll see the
 * system narrate what you're doing.
 */
import { Services } from 'appium-ios-remotexpc';

import { arg, check, heading, info, note, resolveUdid, run, step } from '../lib/lab.mjs';

const seconds = Number(arg('seconds', '8'));
const match = arg('match', null);
const MAX_SHOWN = 12;

await run(async () => {
  heading('05 · Syslog stream', 'Live device log, filtered and time-boxed');

  const udid = await resolveUdid();
  info('UDID', udid);
  info('capture window', `${seconds}s`);
  if (match) {
    info('filter', match);
  }

  // The binary relay (os_trace_relay) is the default; there is also
  // startSyslogTextService() for the iOS 18+ text relay.
  step('Opening the syslog service');
  const { syslogService, serviceDescriptor } = await Services.startSyslogBinaryService(udid);

  const lines = [];
  syslogService.on('message', (line) => {
    const text = String(line).trim();
    if (!text) {
      return;
    }
    if (match && !text.toLowerCase().includes(match.toLowerCase())) {
      return;
    }
    lines.push(text);
  });

  let streamError = null;
  syslogService.on('error', (err) => {
    streamError = err;
  });

  step(`Streaming for ${seconds}s`);
  await syslogService.start(serviceDescriptor);

  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  await syslogService.stop();

  step(`Captured ${lines.length} line(s)`);
  console.log();
  for (const line of lines.slice(0, MAX_SHOWN)) {
    console.log(`  ${line.slice(0, 150)}`);
  }
  if (lines.length > MAX_SHOWN) {
    note(`… and ${lines.length - MAX_SHOWN} more`);
  }
  console.log();

  check('the syslog service started', streamError === null, streamError ? String(streamError) : '');
  check('log lines arrived from the device', lines.length > 0, `${lines.length} line(s)`);
  check('the stream stopped cleanly', true);

  if (lines.length === 0) {
    note('No lines in the window. The device may be idle — unlock it, open an app,');
    note('and re-run with --seconds 15.');
  }

  note('In a harness: start the stream before the test, stop it after, and keep');
  note('the slice only when the test failed.');
});
