/**
 * 02 · Is a tunnel up, and what does it expose?
 *
 * You create the tunnel once, with:
 *
 *   sudo appium driver run xcuitest tunnel-creation
 *
 * That publishes it to a small registry on port 42314. Your test code never
 * builds a tunnel itself — it asks the registry where the device is.
 *
 *   node examples/02-tunnel-status.mjs
 */
import { Services } from 'appium-ios-remotexpc';

import { check, heading, info, note, run, step } from '../lib/lab.mjs';

const REGISTRY = 'http://localhost:42314/remotexpc/tunnels';

await run(async () => {
  heading('02 · Tunnel status', 'One tunnel, published over HTTP, read by everything else');

  step('Asking the library which devices have tunnels');
  const udids = await Services.getAvailableDevices();
  check('at least one device has a live tunnel', udids.length > 0, `${udids.length} device(s)`);

  for (const udid of udids) {
    const tunnel = await Services.getTunnelForDevice(udid);
    console.log();
    info('UDID', udid);
    info('Tunnel address', tunnel.host);
    info('RSD port', tunnel.port);
    check(`tunnel for ${udid.slice(0, 12)}… has an address and RSD port`, Boolean(tunnel.host && tunnel.port));
  }

  // The registry is plain HTTP on purpose: anything that can make a request can
  // find the device, which is how the Appium driver plugs in.
  console.log();
  step(`Reading the registry directly: GET ${REGISTRY}`);

  const response = await fetch(REGISTRY);
  check('registry answers over HTTP', response.ok, `HTTP ${response.status}`);

  const body = await response.json();
  const entries = Object.values(body.tunnels ?? {});
  check('registry lists the same tunnel(s)', entries.length === udids.length, `${entries.length} entry/entries`);

  for (const entry of entries) {
    const serviceCount = Object.keys(entry.services ?? {}).length;
    console.log();
    info('connectionType', entry.connectionType);
    info('deviceId', entry.deviceId);
    info('services in catalog', serviceCount);
    check('the service catalog is populated', serviceCount > 0, `${serviceCount} services`);

    const interesting = [
      'com.apple.mobile.diagnostics_relay.shim.remote',
      'com.apple.os_trace_relay.shim.remote',
      'com.apple.mobile.installation_proxy.shim.remote',
      'com.apple.instruments.dtservicehub',
    ];
    console.log();
    note('A few services the later examples use:');
    for (const name of interesting) {
      const port = entry.services?.[name]?.port;
      check(`  ${name}`, Boolean(port), port ? `port ${port}` : 'not in catalog');
    }
  }

  console.log();
  note('Note the connectionType above: the tunnel works the same whether the');
  note('first hop was USB or WiFi. Nothing below this layer cares.');
});
