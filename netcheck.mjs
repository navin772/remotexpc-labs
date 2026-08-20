#!/usr/bin/env node
/**
 * netcheck.mjs — can this network carry a wireless RemoteXPC tunnel?
 *
 *   node netcheck.mjs
 *
 * Runs on macOS, Windows and Linux. No elevation needed.
 *
 * Wireless iOS automation fails in three unrelated ways, and the symptom —
 * "the tunnel won't start" — looks identical for all of them:
 *
 *   Discovery    The AP drops multicast, so mDNS never crosses the air and
 *                nothing is ever found. Layer 2, fix is on the WLAN.
 *   Transport    Discovery works, but a port the device needs is unreachable.
 *   Adoption     Everything is reachable, but usbmux/AMDS has not published
 *                the device as a Network device, so the tunnel script has
 *                nothing to attach to.
 *
 * The last check is the decisive one: it asks the same library the tunnel
 * script uses, so a pass here means the tunnel has a device to work with.
 *
 * Run it with the device awake, unlocked and on the same SSID. Exit code 0
 * means every requirement is met.
 */
import {execFile, spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {createSocket} from 'node:dgram';
import {connect} from 'node:net';
import {networkInterfaces} from 'node:os';
import {promisify} from 'node:util';

const run = promisify(execFile);

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const LINUX = process.platform === 'linux';

const REMOTEPAIRING_PORT_FALLBACK = 49152;
const LOCKDOWN_PORT = 62078; // what usbmux/AMDS needs to adopt a device over WiFi


const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const rule = () => console.log(dim('─'.repeat(72)));

const failures = [];
let checks = 0;

function check(ok, label, detail = '', kind = null) {
  checks++;
  if (!ok && kind) {
    failures.push(kind);
  }
  console.log(`  ${ok ? green('✓') : red('✗')} ${label}${detail ? ' ' + dim(detail) : ''}`);
  return ok;
}
function skip(label, detail) {
  console.log(`  ${yellow('·')} ${label}${detail ? ' ' + dim(detail) : ''}`);
}

/**
 * Locate the dns-sd CLI.
 *
 * On Windows it ships inside the Bonjour install directory, which the
 * installer often does not add to PATH — so a bare PATH lookup says "missing"
 * for a machine where Bonjour is installed and working perfectly. Look in the
 * real place before concluding anything.
 */
async function resolveDnsSd() {
  if (!WIN) {
    return (await commandExists('dns-sd')) ? 'dns-sd' : null;
  }
  if (await commandExists('dns-sd.exe')) {
    return 'dns-sd.exe';
  }
  const roots = [
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)',
  ].filter(Boolean);
  for (const root of roots) {
    const candidate = `${root}\\Bonjour\\dns-sd.exe`;
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* not here */
    }
  }
  return null;
}

async function commandExists(bin) {
  try {
    await run(WIN ? 'where' : 'which', [bin]);
    return true;
  } catch {
    return false;
  }
}

/** Run a long-lived browser like dns-sd for a fixed window, then kill it. */
function runFor(cmd, args, ms) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(cmd, args, {windowsHide: true});
    } catch {
      return resolve('');
    }
    child.stdout?.on('data', (d) => {
      out += d;
    });
    child.stderr?.on('data', (d) => {
      out += d;
    });
    child.on('error', () => resolve(out));
    const timer = setTimeout(() => child.kill(), ms);
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}

async function powershell(script) {
  try {
    const {stdout} = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {timeout: 20000, windowsHide: true},
    );
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * The interface the OS would actually use to leave this machine.
 *
 * Opening a UDP socket toward a public address and reading back the local
 * address it bound picks the right one on every platform without shelling
 * out to route/ip/Get-NetRoute and parsing three different formats. No
 * packet is ever sent.
 */
function primaryInterface() {
  return new Promise((resolve, reject) => {
    const probe = createSocket('udp4');
    probe.once('error', reject);
    probe.connect(53, '8.8.8.8', () => {
      const local = probe.address().address;
      probe.close();
      for (const [name, addrs] of Object.entries(networkInterfaces())) {
        if (!addrs?.some((a) => a.address === local)) {
          continue;
        }
        const v6 = addrs.find((a) => a.family === 'IPv6' && a.address.startsWith('fe80'));
        return resolve({
          name,
          v4: local,
          index: v6?.scopeid,
          // Windows wants a numeric zone index in fe80::x%N; unix wants the name.
          zone: WIN ? v6?.scopeid : name,
          v6ll: v6?.address?.split('%')[0],
          v6global: addrs.find(
            (a) => a.family === 'IPv6' && !a.address.startsWith('fe80') && !a.internal,
          )?.address,
        });
      }
      reject(new Error(`could not match local address ${local} to an interface`));
    });
  });
}

/** dns-sd rows: `<time>  Add  <flags>  <if>  <domain>  <type>  <name>` */
function parseBrowse(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = /\s(Add|Rmv)\s+\d+\s+(\d+)\s+\S+\s+(\S+)\s+(.*)$/.exec(line);
    if (m && m[1] === 'Add') {
      rows.push({ifIndex: Number(m[2]), type: m[3], name: m[4].trim()});
    }
  }
  return rows;
}

/** avahi-browse -pt rows: `+;iface;proto;name;type;domain` */
function parseAvahi(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const f = line.split(';');
    if (f[0] === '+' || f[0] === '=') {
      rows.push({iface: f[1], type: f[4], name: f[3], host: f[6], addr: f[7], port: Number(f[8])});
    }
  }
  return rows;
}

function tcpProbe(host, port, ms = 4000) {
  return new Promise((resolve) => {
    let sock;
    try {
      sock = connect({host, port});
    } catch {
      return resolve(false);
    }
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(ms);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/** One ICMP echo, with the per-platform spelling of "give up after ~1s". */
async function pingOnce(host) {
  const args = WIN ? ['-n', '1', '-w', '900', host] : MAC ? ['-c', '1', '-W', '900', host] : ['-c', '1', '-W', '1', host];
  try {
    await run('ping', args, {timeout: 4000, windowsHide: true});
    return true;
  } catch {
    return false;
  }
}

console.log(bold('\nRemoteXPC network capability check'));
console.log(dim(`Can this link carry a wireless tunnel?  ${process.platform}`));
rule();

let iface;
try {
  iface = await primaryInterface();
} catch (err) {
  console.log(red(`  Could not determine the active interface: ${err.message}`));
  process.exit(1);
}

console.log(`  Interface             ${iface.name} ${dim(`(index ${iface.index ?? '?'})`)}`);
console.log(`  IPv4                  ${iface.v4}`);
console.log(`  IPv6 link-local       ${iface.v6ll ?? dim('none')}`);
console.log(`  IPv6 global           ${iface.v6global ?? dim('none — not required')}`);
console.log();

// ── Windows only ── The firewall profile decides whether inbound mDNS is even
// allowed to reach Bonjour. A network classified Public silently blocks it,
// which is why the same laptop can work on one SSID and fail on the next.
if (WIN) {
  const alias = iface.name.replace(/'/g, "''");
  const cat = await powershell(
    `(Get-NetConnectionProfile -InterfaceAlias '${alias}').NetworkCategory`,
  );
  if (cat) {
    check(
      /private|domainauthenticated/i.test(cat),
      'Windows network profile allows discovery',
      `profile is ${cat}`,
      'win-profile',
    );
  } else {
    skip('Windows network profile allows discovery', 'could not read Get-NetConnectionProfile');
  }

  // AMDS depends on the Bonjour *service*, not on the CLI being on PATH.
  const svc = await powershell(
    "(Get-Service -Name 'Bonjour Service' -ErrorAction SilentlyContinue).Status",
  );
  check(
    /running/i.test(svc),
    'Bonjour Service is running',
    svc ? `status is ${svc}` : 'service not installed',
    svc ? 'win-bonjour-stopped' : 'win-bonjour',
  );
}

// ── 1 ── Is any *other* host's mDNS reaching us on this interface?
//
// Records we publish ourselves echo on every interface including loopback,
// so anything also seen on index 1 is our own and does not count.
const DNSSD = await resolveDnsSd();
const hasDnsSd = DNSSD !== null;
const hasAvahi = LINUX && (await commandExists('avahi-browse'));

if (hasDnsSd) {
  console.log(cyan('▸') + ' Browsing mDNS for peer advertisements');
  const rows = parseBrowse(await runFor(DNSSD, ['-B', '_services._dns-sd._udp', 'local'], 6000));
  const ours = new Set(rows.filter((r) => r.ifIndex === 1).map((r) => r.name));
  const peers = [
    ...new Set(rows.filter((r) => r.ifIndex === iface.index && !ours.has(r.name)).map((r) => r.name)),
  ];
  check(
    peers.length > 0,
    'Peer mDNS reaches this machine',
    peers.length ? `${peers.length} service type(s): ${peers.slice(0, 5).join(' ')}` : 'only our own records',
    'multicast',
  );
} else if (hasAvahi) {
  console.log(cyan('▸') + ' Browsing mDNS via avahi');
  const peers = parseAvahi(await runFor('avahi-browse', ['-pt', '_services._dns-sd._udp'], 6000));
  check(peers.length > 0, 'Peer mDNS reaches this machine', `${peers.length} record(s)`, 'multicast');
} else if (WIN) {
  // Not fatal on its own: AMDS uses the Bonjour service directly. It only
  // means this script cannot see what mDNS is doing, so the discovery and
  // port checks below are unavailable.
  skip(
    'Peer mDNS reaches this machine',
    'dns-sd.exe not found — discovery checks skipped (see the Bonjour Service check above)',
  );
} else {
  skip('Peer mDNS reaches this machine', 'no dns-sd or avahi-browse available');
}

// ── 2 ── IPv6 neighbour discovery. Apple's wireless pairing rides on fe80::.
if (WIN) {
  // Windows ping reports at most one responder for a multicast destination,
  // so this measurement is not meaningful here. The device-specific
  // link-local probe further down covers the same ground properly.
  skip('IPv6 neighbours answer on ff02::1', 'not measurable with Windows ping — see link-local probe below');
} else {
  const args = MAC
    ? ['-c', '3', `ff02::1%${iface.name}`]
    : ['-6', '-c', '3', `ff02::1%${iface.name}`];
  const bin = MAC ? 'ping6' : 'ping';
  const {stdout} = await run(bin, args, {timeout: 12000}).catch((e) => ({stdout: `${e.stdout ?? ''}`}));
  const peers = new Set(
    [...stdout.matchAll(/from\s+([0-9a-f:]+)%/gi)].map((m) => m[1]).filter((a) => a !== iface.v6ll),
  );
  check(peers.size > 0, 'IPv6 neighbours answer on ff02::1', `${peers.size} peer(s)`, 'ipv6');
}

// ── 3 ── Plain unicast between clients. Proves isolation is not the problem.
try {
  const {stdout} = await run('arp', WIN ? ['-a'] : ['-an'], {timeout: 10000, windowsHide: true});
  const peers = [...stdout.matchAll(/(\d+\.\d+\.\d+\.\d+)/g)]
    .map((m) => m[1])
    .filter((ip) => ip !== iface.v4 && !ip.endsWith('.255') && !ip.startsWith('224.') && !ip.startsWith('239.'))
    .filter((ip, i, a) => a.indexOf(ip) === i)
    .slice(0, 6);
  let ok = 0;
  for (const ip of peers) {
    if (await pingOnce(ip)) {
      ok++;
    }
  }
  check(ok > 0, 'Unicast client-to-client works', `${ok}/${peers.length} peers replied`, 'isolation');
} catch {
  skip('Unicast client-to-client works', 'could not read the arp table');
}

// ── 4/5 ── Find the device over WiFi and prove its ports are reachable.
let device = null;

if (hasDnsSd) {
  const rows = parseBrowse(await runFor(DNSSD, ['-B', '_remotepairing._tcp', 'local'], 6000));
  const onWifi = rows.filter((r) => r.ifIndex === iface.index);
  const found = check(
    onWifi.length > 0,
    `A device advertises _remotepairing._tcp on ${iface.name}`,
    onWifi.length ? onWifi[0].name : 'nothing over WiFi',
    'discovery',
  );

  if (found) {
    const lookup = await runFor(DNSSD, ['-L', onWifi[0].name, '_remotepairing._tcp', 'local'], 4000);
    const m = /can be reached at\s+(\S+?)\.?:(\d+)/.exec(lookup);
    const host = m?.[1];
    const port = m ? Number(m[2]) : REMOTEPAIRING_PORT_FALLBACK;

    if (host) {
      const g = await runFor(DNSSD, ['-G', 'v4v6', host], 4000);
      const v4 = new RegExp(`\\s${iface.index}\\s+\\S+\\s+(\\d+\\.\\d+\\.\\d+\\.\\d+)`).exec(g);
      const v6 = new RegExp(`\\s${iface.index}\\s+\\S+\\s+(FE80:[0-9A-F:]+)%`, 'i').exec(g);
      device = {
        host,
        port,
        v4: v4?.[1] ?? null,
        v6ll: v6?.[1] ? `${v6[1]}%${iface.zone}` : null,
      };
    }
  }
} else if (hasAvahi) {
  const rows = parseAvahi(await runFor('avahi-browse', ['-rpt', '_remotepairing._tcp'], 6000)).filter(
    (r) => r.addr,
  );
  const found = check(rows.length > 0, `A device advertises _remotepairing._tcp`, rows[0]?.name ?? 'nothing', 'discovery');
  if (found) {
    device = {host: rows[0].host, port: rows[0].port || REMOTEPAIRING_PORT_FALLBACK, v4: rows[0].addr, v6ll: null};
  }
}

if (device) {
  const target = device.v4 ?? device.v6ll;
  console.log(dim(`    device ${device.host} → ${target}`));
  if (target) {
    check(await tcpProbe(target, device.port), 'RemoteXPC pairing port reachable', `tcp/${device.port}`, 'port-remotepairing');
    check(
      await tcpProbe(target, LOCKDOWN_PORT),
      'Lockdown port reachable',
      `tcp/${LOCKDOWN_PORT} — needed to adopt the device over WiFi`,
      'port-lockdown',
    );
  }
  if (device.v6ll) {
    check(
      await tcpProbe(device.v6ll, LOCKDOWN_PORT),
      'IPv6 link-local reachable to the device',
      device.v6ll,
      'ipv6-device',
    );
  } else {
    skip('IPv6 link-local reachable to the device', 'no link-local address advertised on this interface');
  }
}

// ── 6 ── The payoff. Ask the same library the tunnel script asks.
//
// On macOS and Linux this talks to usbmuxd; on Windows it talks to the Apple
// Mobile Device Service on 127.0.0.1:27015. Everything above can pass and
// this can still fail — that is the case that wastes an afternoon.
{
  let createUsbmux;
  try {
    ({createUsbmux} = await import('appium-ios-remotexpc'));
  } catch {
    skip('A Network device is published to the tunnel script', 'run npm install first');
  }

  if (createUsbmux) {
    const deadline = Date.now() + 45_000;
    let net = [];
    let usb = [];
    let waited = false;
    for (;;) {
      let usbmux;
      try {
        usbmux = await createUsbmux();
        const devices = await usbmux.listDevices();
        net = devices.filter((d) => d.Properties?.ConnectionType === 'Network');
        usb = devices.filter((d) => d.Properties?.ConnectionType === 'USB');
      } catch {
        /* service not reachable yet */
      } finally {
        try {
          usbmux?.close();
        } catch {
          /* already gone */
        }
      }
      if (net.length > 0 || Date.now() > deadline) {
        break;
      }
      if (!waited) {
        waited = true;
        console.log(cyan('▸') + dim(' waiting for the device to be adopted over WiFi (up to 45s)'));
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    check(
      net.length > 0,
      'A Network device is published to the tunnel script',
      net.length
        ? net.map((d) => d.Properties.SerialNumber).join(' ')
        : 'still nothing after 45s — the tunnel will have nothing to attach to',
      'adoption',
    );
    if (usb.length > 0) {
      console.log(
        dim(`    note: a USB row is also present — the tunnel script prefers USB and will use the cable`),
      );
    }
  }
}

rule();

if (failures.length === 0) {
  console.log(`${green('PASS')} this network can carry a wireless RemoteXPC tunnel\n`);
  console.log(dim('  Reminder: the tunnel script prefers USB whenever a USB row exists,'));
  console.log(dim('  so unplug the cable before demoing or you will be tunnelling over it.\n'));
  process.exit(0);
}

console.log(`${red('FAIL')} ${failures.length} of ${checks} checks failed\n`);

const said = new Set();
const say = (k, lines) => {
  if (failures.includes(k) && !said.has(k)) {
    said.add(k);
    console.log(yellow(`  ${lines[0]}`));
    for (const l of lines.slice(1)) {
      console.log(dim(`  ${l}`));
    }
    console.log();
  }
};

say('win-profile', [
  'This network is classified Public, so Windows Firewall is blocking inbound mDNS.',
  'Nothing will be discovered until you change it:',
  `  Set-NetConnectionProfile -InterfaceAlias '${iface.name}' -NetworkCategory Private`,
  'This is the usual reason a Windows host works on one SSID and not the next.',
]);
say('win-bonjour', [
  'Bonjour Service is not installed, so the Apple Mobile Device Service cannot',
  'see devices over WiFi. USB keeps working and wireless never will.',
  'The Microsoft Store "Apple Devices" app does NOT include Bonjour — install',
  'iTunes from apple.com, or Bonjour64.msi from that installer.',
]);
say('win-bonjour-stopped', [
  'Bonjour Service is installed but not running. Start it and re-run:',
  '  Start-Service "Bonjour Service"',
  '  Set-Service "Bonjour Service" -StartupType Automatic',
]);
say('multicast', [
  'The AP is dropping multicast between wireless clients.',
  'Discovery cannot work here. Changing subnet, DHCP scope or ISP uplink will',
  'not help — this is a layer-2 setting on the WLAN. Ask for client isolation',
  'off and multicast/mDNS forwarding on for this SSID.',
]);
say('ipv6', [
  'No IPv6 neighbours are reachable on this link.',
  "Apple's wireless pairing uses fe80:: link-local addresses, so ICMPv6",
  'Neighbour Discovery and MLD must not be filtered — even on an IPv4 network.',
]);
say('isolation', ['No other client answered unicast. Client isolation may be enabled.']);
say('discovery', [
  'No device is advertising _remotepairing._tcp over WiFi.',
  'Either the device is not on this SSID, is asleep, or multicast is blocked.',
]);
say('port-remotepairing', [
  'The device was discovered but its pairing port refused the connection.',
  'Discovery is fine; something is filtering client-to-client TCP.',
]);
say('port-lockdown', [
  `The device was discovered but tcp/${LOCKDOWN_PORT} is unreachable.`,
  'This is the port used to adopt a device over WiFi. Without it you get',
  'discovery but no Network device, and the tunnel never starts.',
]);
say('ipv6-device', [
  'The device is advertising an IPv6 link-local address that is not reachable.',
  'ICMPv6 Neighbour Discovery is probably being filtered between clients.',
]);
say('adoption', [
  'No Network device was published, so the tunnel script has nothing to attach to.',
  WIN
    ? 'Check "Sync with this iPhone over WiFi" in Apple Devices/iTunes, confirm the\n  network profile is Private, and confirm Bonjour Service is running.'
    : "Cycle the Mac's WiFi — this clears a stale usbmuxd view and is by far the\n  most common fix:\n    networksetup -setairportpower en0 off && sleep 4 && networksetup -setairportpower en0 on",
]);

process.exit(1);
