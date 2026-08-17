/**
 * Runs every example in order and prints a summary.
 *
 *   npm run all
 *
 * Useful as a smoke test of your setup before the workshop: if all ten pass,
 * your tunnel and device are healthy.
 */
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';

const quiet = process.argv.includes('--quiet');

const files = (await readdir('examples')).filter((f) => f.endsWith('.mjs')).sort();

const results = [];

for (const file of files) {
  if (!quiet) {
    console.log(`\n${'═'.repeat(64)}\n${file}\n${'═'.repeat(64)}`);
  }
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [`examples/${file}`], {
      stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit',
    });
    child.on('close', resolve);
  });
  results.push({ file, ok: code === 0 });
}

console.log(`\n${'═'.repeat(64)}\nSummary\n${'═'.repeat(64)}`);
for (const { file, ok } of results) {
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${file}`);
}

const failed = results.filter((r) => !r.ok);
console.log();
if (failed.length === 0) {
  console.log(`\x1b[32mAll ${results.length} examples passed.\x1b[0m\n`);
} else {
  console.log(`\x1b[31m${failed.length} of ${results.length} examples failed.\x1b[0m\n`);
}
process.exit(failed.length === 0 ? 0 : 1);
