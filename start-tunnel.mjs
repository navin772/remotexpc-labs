/**
 * Start a tunnel to your iOS device, and publish it so the examples can find it.
 *
 *   sudo node start-tunnel.mjs
 *   sudo node start-tunnel.mjs --udid 00008030-001E290A3EF2402E
 *   sudo node start-tunnel.mjs --port 42314
 *
 * Leave it running. Open a second terminal for the examples.
 *
 * Nothing here is special to this repo — it is the library's public API, in the
 * order the README describes:
 *
 *   usbmux  →  lockdown  →  CoreDeviceProxy  →  TUN/IPv6  →  RSD  →  registry
 *
 * If you already run Appium's XCUITest driver, `sudo appium driver run xcuitest
 * tunnel-creation` does the same job with more retry handling. This script
 * exists so the workshop needs nothing but this repo.
 */
import {
  TunnelManager,
  createLockdownServiceByUDID,
  createUsbmux,
  discoverServices,
  servicesToCatalog,
  startCoreDeviceProxyTcp,
  startTunnelRegistryServer,
} from 'appium-ios-remotexpc';

import { arg, heading, info, note, step } from './lib/lab.mjs';

const registryPort = Number(arg('port', '42314'));
const wantedUdid = arg('udid', process.env.UDID ?? null);

const C = { ok: '\x1b[32m', bad: '\x1b[31m', warn: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' };

/** Creating a virtual network interface is privileged on every OS. */
function assertElevated() {
  if (process.platform === 'win32') {
    note('On Windows, run this from an Administrator PowerShell.');
    return;
  }
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    console.log(`
${C.bad}This needs root.${C.off}

Creating the TUN interface the tunnel rides on is a privileged operation.
Re-run it as:

  ${C.bold}sudo node start-tunnel.mjs${C.off}
`);
    process.exit(1);
  }
}

/** Pick the device to tunnel to, preferring a WiFi row when one exists. */
async function pickDevice() {
  const usbmux = await createUsbmux();
  try {
    const devices = await usbmux.listDevices();
    if (!devices.length) {
      throw new Error('usbmuxd sees no devices. Plug the device in and tap Trust.');
    }

    const matching = wantedUdid
      ? devices.filter((d) => d.Properties?.SerialNumber === wantedUdid)
      : devices;

    if (!matching.length) {
      throw new Error(`No device with UDID ${wantedUdid}.`);
    }

    // The same phone can appear twice: once as USB, once as Network. Either
    // works; we prefer the wireless row so the cable really is optional.
    const network = matching.find((d) => d.Properties?.ConnectionType === 'Network');
    const chosen = network ?? matching[0];

    const udids = new Set(matching.map((d) => d.Properties?.SerialNumber));
    if (!wantedUdid && udids.size > 1) {
      note(`${udids.size} devices connected; using the first. Pass --udid to choose.`);
    }
    return chosen;
  } finally {
    await usbmux.close();
  }
}

async function buildTunnel(device) {
  const udid = device.Properties.SerialNumber;

  step(`Opening lockdown on ${udid}`);
  const { lockdownService } = await createLockdownServiceByUDID(udid);

  step('Starting CoreDeviceProxy');
  const { socket, cert, key } = await startCoreDeviceProxyTcp(lockdownService, device.DeviceID, udid);

  step('Creating the TUN interface and IPv6 tunnel');
  const tunnel = await TunnelManager.getTunnel(socket, { cert, key }, {
    onDead: (reason) => {
      console.log(`\n${C.warn}Tunnel died: ${reason}${C.off}`);
      console.log(`${C.dim}The device probably slept or left the network. Re-run this script.${C.off}`);
    },
  });

  if (!tunnel.RsdPort) {
    throw new Error('Tunnel came up without an RSD port; cannot discover services.');
  }

  step('Running RSD discovery');
  const services = await discoverServices(udid, tunnel.Address, tunnel.RsdPort);
  const catalog = servicesToCatalog(services);

  const now = Date.now();
  const entry = {
    udid,
    deviceId: device.DeviceID,
    address: tunnel.Address,
    rsdPort: tunnel.RsdPort,
    services: catalog,
    catalogUpdatedAt: now,
    connectionType: device.Properties.ConnectionType ?? 'USB',
    productId: device.Properties.ProductID ?? 0,
    createdAt: now,
    lastUpdated: now,
  };

  return { tunnel, entry, serviceCount: Object.keys(catalog).length };
}

heading('Start a tunnel', 'Leave this running, then use the examples in another terminal');

assertElevated();

const device = await pickDevice();
info('UDID', device.Properties.SerialNumber);
info('DeviceID', device.DeviceID);
info('ConnectionType', device.Properties.ConnectionType ?? '(unknown)');
console.log();

const { tunnel, entry, serviceCount } = await buildTunnel(device);

const registry = { tunnels: {}, metadata: { lastUpdated: new Date().toISOString(), totalTunnels: 0, activeTunnels: 0 } };
const server = await startTunnelRegistryServer(registry, registryPort);
server.upsertReadyEntry(entry.udid, entry);

console.log();
info('tunnel address', entry.address);
info('RSD port', entry.rsdPort);
info('services found', serviceCount);
info('registry', `http://localhost:${registryPort}/remotexpc/tunnels`);

console.log(`
${C.ok}Tunnel is up.${C.off} Leave this terminal alone.

In another terminal:

  ${C.bold}npm run tunnel${C.off}       confirm the registry sees it
  ${C.bold}npm run battery${C.off}      first real service call
  ${C.bold}npm run all${C.off}          the whole set

${C.dim}Press Ctrl+C here to tear the tunnel down.${C.off}
`);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`\n${C.dim}${signal} — closing tunnel and registry…${C.off}`);
  try {
    await server.stop();
  } catch {
    // already down
  }
  try {
    await tunnel.closer();
  } catch {
    // already closed
  }
  console.log(`${C.ok}Closed.${C.off}\n`);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
