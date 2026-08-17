/**
 * 08 · CPU and memory, per process
 *
 * The practical use: assert a performance budget for your app as part of a test,
 * measured on the device rather than inferred from wall-clock time.
 *
 *   node examples/08-performance.mjs
 *   node examples/08-performance.mjs --samples 5 --app Preferences
 */
import { Services } from 'appium-ios-remotexpc';

import { arg, check, heading, info, note, resolveUdid, run, step } from '../lib/lab.mjs';

const wanted = Number(arg('samples', '3'));
const appFilter = arg('app', null);

await run(async () => {
  heading('08 · Performance sampling', 'sysmontap: what the device is actually doing');

  const udid = await resolveUdid();
  info('UDID', udid);
  info('samples', wanted);

  step('Opening the DVT service');
  const dvt = await Services.startDVTService(udid);

  const samples = [];
  try {
    step('Streaming process snapshots');
    // iterProcesses() is an async generator: take what you need, then break.
    for await (const processes of dvt.sysmontap.iterProcesses()) {
      samples.push(processes);
      if (samples.length >= wanted) {
        break;
      }
    }
  } finally {
    await dvt.dvtService.close();
  }

  check('sysmontap produced snapshots', samples.length > 0, `${samples.length} sample(s)`);

  const latest = samples.at(-1) ?? [];
  check('a snapshot lists running processes', latest.length > 0, `${latest.length} processes`);

  const byCpu = [...latest]
    .filter((p) => typeof p.cpuUsage === 'number')
    .sort((a, b) => b.cpuUsage - a.cpuUsage)
    .slice(0, 8);

  console.log();
  step('Busiest processes in the last snapshot');
  for (const proc of byCpu) {
    const mem = typeof proc.physFootprint === 'number' ? `${(proc.physFootprint / 1e6).toFixed(1)} MB` : '';
    info((proc.name ?? '(unnamed)').slice(0, 22), `cpu ${proc.cpuUsage.toFixed(1)}%${mem ? ` · ${mem}` : ''}`);
  }
  check('CPU usage is reported numerically', byCpu.length > 0);

  if (appFilter) {
    console.log();
    step(`Looking for a process matching "${appFilter}"`);
    const hit = latest.find((p) => String(p.name ?? '').toLowerCase().includes(appFilter.toLowerCase()));
    if (hit) {
      info('name', hit.name);
      info('cpu', typeof hit.cpuUsage === 'number' ? `${hit.cpuUsage.toFixed(1)}%` : '(n/a)');
      info('memory', typeof hit.physFootprint === 'number' ? `${(hit.physFootprint / 1e6).toFixed(1)} MB` : '(n/a)');
      check(`found "${appFilter}" in the snapshot`, true);
      note('This is the number you would assert a budget against.');
    } else {
      note(`No process matching "${appFilter}" — launch it first (see example 06).`);
    }
  } else {
    console.log();
    note('Pass --app <name> to pull out one process, e.g. --app Preferences');
    note('after running example 06 with --launch com.apple.Preferences.');
  }

  console.log();
  note('One sysmontap session per DVT connection: open a fresh one per measurement.');
});
