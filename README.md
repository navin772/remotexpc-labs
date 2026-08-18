# RemoteXPC Labs

Runnable examples for **Engineering RemoteXPC: Building Wireless iOS Automation with Appium**
— TestMu Conference 2026.

Every example is a standalone script. Run one, read what it prints, and it tells you whether it
worked. Nothing here needs a build step, a test framework, or TypeScript.

```bash
node examples/04-battery-diagnostics.mjs
```

```
04 · Battery diagnostics
Decide whether this device is fit to run a suite
────────────────────────────────────────────────────────────────
  UDID                  00008030-001E290A3EF2402E
▸ Opening the diagnostics service
▸ Querying IORegistry for 'IOPMPowerSource'
  ✓ ioregistry() returned a power source

  BatteryInstalled      true
  CurrentCapacity       83%
  ExternalConnected     true

  ✓ a battery is installed
  ✓ battery level is readable 83%
  ✓ battery is above the 15% floor for a long run 83% vs 15%
────────────────────────────────────────────────────────────────
PASS 4 checks succeeded
```

Exit code is `0` when every check passed and `1` when any failed, so these work in CI too.

---

## Setup

### 1. Prerequisites

- **Node** 20.19+, 22.12+, or 24+
- An **iPhone or iPad on iOS 17 or newer**
- A **USB cable** — for the first pairing only
- `sudo` on macOS/Linux, an **Administrator** shell on Windows
- Device and host on the **same network**

### 2. Install

```bash
git clone https://github.com/navin772/remotexpc-labs.git
cd remotexpc-labs
npm install
```

That pulls `appium-ios-remotexpc` from npm. You do **not** need to clone the library itself.

### 3. Trust the device, once

1. Plug the device in.
2. Unlock it and tap **Trust**.
3. Optional but recommended — make it reachable without the cable:
   **Finder** → select the device → tick **Show this iPhone when on WiFi**
   (or Xcode → *Window* → *Devices and Simulators* → *Connect via network*).
4. Check the host can see it:

```bash
npm run devices
```

A row with `ConnectionType: Network` means the cable is now optional. A row with
`ConnectionType: USB` is fine too — **every example works over either transport.** That is the
whole point.

### 4. Start a tunnel, and leave it running

Nothing else works until a tunnel exists. In a **separate terminal**:

```bash
sudo node start-tunnel.mjs
```

Keep that process alive — it owns the tunnel. `sudo` is needed because creating a virtual
network interface is a privileged operation on every OS. Press Ctrl+C to tear it down.

`start-tunnel.mjs` uses only the library's public API, in the order the README of
`appium-ios-remotexpc` describes:

```
usbmux → lockdown → CoreDeviceProxy → TUN/IPv6 → RSD → registry
```

Options: `--udid <udid>` to pick a device, `--port <n>` to move the registry off 42314.

**Already using Appium?** The XCUITest driver ships an equivalent with more retry handling,
and either one works:

```bash
appium driver install xcuitest        # once, if you don't have it
sudo appium driver run xcuitest tunnel-creation
```

Use one or the other, not both — they would fight over port 42314.

Confirm it is published:

```bash
npm run tunnel
# or, the raw seam:
curl http://localhost:42314/remotexpc/tunnels
```

### 5. Run everything

```bash
npm run all
```

Ten examples, about 90 seconds. If all ten pass, your setup is healthy.

---

## The examples

| | Script | What it shows |
|---|---|---|
| 01 | `npm run devices` | usbmuxd lists USB **and** WiFi devices in one list |
| 02 | `npm run tunnel` | The tunnel registry, and the service catalog behind it |
| 03 | `npm run info` | Device identity, CPU, storage, display, orientation |
| 04 | `npm run battery` | Battery and power state — gate a suite on it |
| 05 | `npm run syslog` | Live device log, time-boxed and filterable |
| 06 | `npm run apps` | List installed apps, then launch one |
| 07 | `npm run location` | Move a real device to Apple Park and back |
| 08 | `npm run perf` | Per-process CPU and memory from the device |
| 09 | `npm run screenshot` | Capture the screen to a PNG |
| 10 | `npm run crashes` | List and pull crash reports |

Plus `sudo node start-tunnel.mjs` at the repo root, which starts the tunnel everything else
depends on.

### Useful flags

```bash
node examples/05-syslog-stream.mjs --seconds 15 --match SpringBoard
node examples/06-apps.mjs --launch com.apple.Preferences
node examples/07-simulate-location.mjs --lat 48.8584 --lon 2.2945 --hold 20
node examples/08-performance.mjs --samples 5 --app Preferences
node examples/09-screenshot.mjs --out ./artifacts/before-checkout.png
node examples/10-crash-reports.mjs --pull ./artifacts/crashes
node examples/04-battery-diagnostics.mjs --min 30
```

With more than one device connected, pin the one you mean:

```bash
UDID=00008030-001E290A3EF2402E npm run battery
```

### Try them in this order

`01` → `02` prove your plumbing works. Then `06 --launch com.apple.Preferences` followed by
`09` is a satisfying pair: launch Settings over the network, then screenshot what you just did.

---

## What these examples do *not* do

They are read-only apart from launching an app and simulating a location, both of which are
reversible. Nothing here uninstalls apps, clears the device's crash store, or reboots anything.
Each of those is a single call and is shown in a comment where relevant, so you can see the
shape without us mutating your device.

Captured screenshots and pulled crash reports land in `artifacts/`, which is **gitignored** —
device screenshots contain your account name, WiFi SSID, and whatever is on screen. Don't
commit them.

---

## Troubleshooting

**"No device has a live tunnel"** — the tunnel isn't running, or it died. Restart
`sudo node start-tunnel.mjs` and check `curl http://localhost:42314/remotexpc/tunnels`.

**No `Network` row in `npm run devices`** — "Show this device when on WiFi" is off, or the host
and device are on different networks. Guest WiFi with client isolation blocks this entirely.

**Interface creation fails** — you aren't elevated. `sudo` on macOS/Linux, *Run as
Administrator* on Windows.

**The tunnel dies after a few minutes** — the device slept or dropped off WiFi. Keep it awake
and on power for long runs.

**A service is missing from the catalog** in `npm run tunnel` — the developer disk image isn't
mounted. Some services only appear once it is.

**Some calls time out on your iOS version.** Not every CoreDevice action exists everywhere.
On the device these examples were written against, `getLockState()`, `queryMobileGestalt()` and
the whole CoreDevice **app service** (`startAppService`) time out — which is why example 06
launches apps through DVT process control instead. Example 03 shows the pattern: treat
version-dependent calls as optional and wrap them.

**See what the library is doing:**

```bash
APPIUM_IOS_REMOTEXPC_LOG_LEVEL=debug npm run battery
DEBUG=1 npm run battery     # full stack traces from the examples
```

---

## Where this fits

`appium-ios-remotexpc` is the communication layer the **Appium XCUITest driver** builds on. You
are calling the same code the driver calls — these examples just skip the driver and talk to the
device directly, which is the clearest way to see what the layer actually gives you.

- Library: <https://github.com/appium/appium-ios-remotexpc> · Apache-2.0
- Companion transport: `appium-ios-tuntap` (the virtual interface; WinTun on Windows)

Apache-2.0, same as the library.
