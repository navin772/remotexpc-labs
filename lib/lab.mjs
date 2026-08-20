/**
 * Shared plumbing for the workshop examples.
 *
 * Nothing in this file is part of appium-ios-remotexpc. It exists so every
 * example prints the same shape of output, verifies itself the same way, and
 * fails with the same hint when the tunnel isn't up.
 */
import { Services } from 'appium-ios-remotexpc';

const C = {
  ok: '\x1b[32m',
  bad: '\x1b[31m',
  warn: '\x1b[33m',
  acc: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  off: '\x1b[0m',
};

let passed = 0;
let failed = 0;
let skipped = 0;

export function heading(title, subtitle) {
  console.log(`\n${C.bold}${title}${C.off}`);
  if (subtitle) {
    console.log(`${C.dim}${subtitle}${C.off}`);
  }
  console.log(`${C.dim}${'─'.repeat(64)}${C.off}`);
}

/** A thing we are about to do. */
export function step(message) {
  console.log(`${C.acc}▸${C.off} ${message}`);
}

/** A label/value pair of observed data. */
export function info(label, value) {
  console.log(`  ${C.dim}${String(label).padEnd(22)}${C.off}${value}`);
}

export function note(message) {
  console.log(`${C.dim}  ${message}${C.off}`);
}

/**
 * The verification primitive. Every example ends with a few of these so you
 * can tell at a glance whether it actually worked.
 */
export function check(label, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ${C.ok}✓${C.off} ${label}${detail ? ` ${C.dim}${detail}${C.off}` : ''}`);
  } else {
    failed++;
    console.log(`  ${C.bad}✗${C.off} ${label}${detail ? ` ${C.dim}${detail}${C.off}` : ''}`);
  }
  return ok;
}

/**
 * Not every device exposes every service — the catalog differs by iOS version
 * and device. A missing service is a skip, not a failure.
 */
export function skip(reason) {
  skipped++;
  console.log(`  ${C.warn}○${C.off} skipped ${C.dim}${reason}${C.off}`);
}

function finish() {
  console.log(`${C.dim}${'─'.repeat(64)}${C.off}`);
  if (failed === 0 && skipped > 0 && passed === 0) {
    console.log(`${C.warn}SKIPPED${C.off} this device does not expose the service\n`);
    process.exit(0);
  }
  if (failed === 0 && passed > 0) {
    console.log(`${C.ok}PASS${C.off} ${passed} check${passed === 1 ? '' : 's'} succeeded\n`);
  } else if (failed > 0) {
    console.log(`${C.bad}FAIL${C.off} ${failed} of ${passed + failed} checks failed\n`);
  } else {
    console.log(`${C.warn}NO CHECKS RAN${C.off}\n`);
  }
  // Services hold sockets open, so exit explicitly rather than waiting for the
  // event loop to drain.
  process.exit(failed === 0 && passed > 0 ? 0 : 1);
}

function tunnelHint() {
  console.log(`
${C.warn}No tunnel found for this device.${C.off}

A tunnel has to exist before any service call works. Start one in another
terminal and leave it running:

  ${C.bold}sudo node start-tunnel.mjs${C.off}

Then check it is published:

  ${C.bold}curl http://localhost:42314/remotexpc/tunnels${C.off}
`);
}

/**
 * Wraps an example so failures print usefully instead of as a raw stack.
 */
export async function run(fn) {
  try {
    await fn();
  } catch (err) {
    const message = String(err?.message ?? err);
    // "Service com.apple.x not found in tunnel catalog" — the device simply
    // does not have it. Report it as a skip so mixed-device rooms stay green.
    const missing = message.match(/Service (\S+) not found in tunnel catalog/);
    if (missing) {
      skip(`${missing[1]} is not in this device's service catalog`);
      console.log(`${C.dim}  Service availability varies by iOS version and device.${C.off}`);
      finish();
      return;
    }
    failed++;
    console.log(`\n${C.bad}✗ ${message}${C.off}`);
    if (/tunnel|registry|ECONNREFUSED|not available|no such/i.test(message)) {
      tunnelHint();
    } else if (process.env.DEBUG) {
      console.error(err);
    } else {
      console.log(`${C.dim}  Re-run with DEBUG=1 for the full stack.${C.off}`);
    }
  }
  finish();
}

/**
 * Which device are we talking to?
 *
 * Set UDID to pin one; otherwise we take the first device that has a live
 * tunnel, which is what you want when only one phone is connected.
 */
export async function resolveUdid() {
  if (process.env.UDID) {
    return process.env.UDID;
  }
  const udids = await Services.getAvailableDevices();
  if (!udids.length) {
    throw new Error('No device has a live tunnel. Start one first.');
  }
  if (udids.length > 1) {
    note(`${udids.length} devices have tunnels; using the first. Set UDID to choose.`);
  }
  return udids[0];
}

/** The tunnel endpoint the services will ride over: { host, port, udid }. */
export async function tunnelFor(udid) {
  const tunnel = await Services.getTunnelForDevice(udid);
  if (!tunnel?.host) {
    throw new Error(`No tunnel registered for ${udid}.`);
  }
  return tunnel;
}

/** Reads a `--flag value` style argument from argv. */
export function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** True when `--flag` is present. */
export function flag(name) {
  return process.argv.includes(`--${name}`);
}
