/**
 * Start a tunnel to your iOS device, and leave it running.
 *
 *   sudo node start-tunnel.mjs
 *   sudo node start-tunnel.mjs --udid 00008030-001E290A3EF2402E
 *   sudo node start-tunnel.mjs --help
 *
 * This is a launcher, not an implementation. It runs the tunnel-creation script
 * that ships inside appium-ios-remotexpc, so you get the library's own retry,
 * reconnect and cleanup handling rather than a simplified copy of it.
 *
 * The script is already on your disk: appium-ios-remotexpc publishes its
 * `scripts/` directory to npm, so `npm install` puts it in node_modules. All
 * this file does is find it and hand over your arguments.
 *
 * Open a second terminal for the examples. Ctrl+C here tears the tunnel down.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = 'appium-ios-remotexpc';
const SCRIPT = join('scripts', 'tunnel-creation.mjs');

/** Walk up from the package's entry point to its root directory. */
function packageRoot() {
  const entry = fileURLToPath(import.meta.resolve(PKG));
  const marker = `${sep}${PKG}${sep}`;
  const at = entry.lastIndexOf(marker);
  if (at === -1) {
    // Fall back to the directory tree above the entry file.
    let dir = dirname(entry);
    while (dir !== dirname(dir)) {
      if (existsSync(join(dir, SCRIPT))) {
        return dir;
      }
      dir = dirname(dir);
    }
    throw new Error(`Could not locate the ${PKG} package root from ${entry}`);
  }
  return entry.slice(0, at + marker.length - 1);
}

let scriptPath;
try {
  scriptPath = join(packageRoot(), SCRIPT);
} catch (err) {
  console.error(`\nCould not find ${PKG}. Run \`npm install\` first.\n${err.message}\n`);
  process.exit(1);
}

if (!existsSync(scriptPath)) {
  console.error(`
The tunnel script is missing from ${PKG}:

  ${scriptPath}

That directory normally ships with the package. Either the install is
incomplete (try \`npm install\`), or this version of the library stopped
publishing scripts/. In that case use the Appium driver instead:

  sudo appium driver run xcuitest tunnel-creation
`);
  process.exit(1);
}

// The library enforces this too, but its message names its own path, which is
// confusing when you typed `start-tunnel.mjs`. Fail early with the right command.
const askedForHelp = process.argv.includes('--help') || process.argv.includes('-h');
if (!askedForHelp && process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0) {
  console.error(`
Creating the tunnel's network interface needs root. Re-run as:

  sudo node start-tunnel.mjs

On Windows, use an Administrator PowerShell instead.
`);
  process.exit(1);
}

const child = spawn(process.execPath, [scriptPath, ...process.argv.slice(2)], { stdio: 'inherit' });

// Let the child own Ctrl+C: it closes the tunnel and the registry on its way out.
child.on('close', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
child.on('error', (err) => {
  console.error(`\nFailed to start the tunnel script: ${err.message}\n`);
  process.exit(1);
});
