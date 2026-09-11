// Where a project's memory goes, from headless Chrome over CDP.
//
// Opens /demo/<id> (or any project URL), waits for the manager, then samples
// the RENDERER PROCESS (RSS from /proc, JS heap from Performance.getMetrics,
// DOM counters) after each stage: manager, idle warm-up, each launcher, the
// 3D viewer. Written for a Chrome "Aw, Snap! Out of Memory" report on a
// medium-sized project (2026-09-11).
//
//   PROF=$S/prof node --experimental-websocket qa/probes/memory_timeline.mjs \
//       https://designer.ziroeda.com/demo/video
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const [url] = process.argv.slice(2);
const port = 9335;
const chrome = spawn(
  '/usr/bin/google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--use-angle=gl',
    '--window-size=1600,1000',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${process.env.PROF}`,
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore', env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' } },
);
await sleep(1500);
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) pending.get(m.id)(m);
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evalJs = async (expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result
    ?.result?.value;
await send('Page.enable');
await send('Runtime.enable');
await send('Performance.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

// Renderer PID: the chrome child whose cmdline has --type=renderer and is not an extension/utility.
const rendererPids = () => {
  const ppid = new Map();
  const cmd = new Map();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      ppid.set(+d, +/PPid:\s+(\d+)/.exec(readFileSync(`/proc/${d}/status`, 'utf8'))[1]);
      cmd.set(+d, readFileSync(`/proc/${d}/cmdline`, 'utf8'));
    } catch {}
  }
  const mine = (p) => {
    for (let i = 0; i < 8 && p > 1; i++) {
      if (p === chrome.pid) return true;
      p = ppid.get(p) ?? 0;
    }
    return false;
  };
  return [...cmd.keys()].filter((p) => cmd.get(p).includes('--type=renderer') && mine(p));
};
const rssMB = (pid) => {
  try {
    const s = readFileSync(`/proc/${pid}/status`, 'utf8');
    const rss = /VmRSS:\s+(\d+)/.exec(s)?.[1];
    const hwm = /VmHWM:\s+(\d+)/.exec(s)?.[1];
    return { rss: Math.round(rss / 1024), hwm: Math.round(hwm / 1024) };
  } catch {
    return null;
  }
};
const sample = async (label) => {
  await sleep(300);
  const m = (await send('Performance.getMetrics')).result.metrics;
  const g = (n) => m.find((x) => x.name === n)?.value ?? 0;
  const pids = rendererPids();
  const procs = pids
    .map((p) => ({ p, ...rssMB(p) }))
    .filter((x) => x.rss)
    .sort((a, b) => b.rss - a.rss);
  const top = procs[0];
  console.log(
    `${label.padEnd(34)} heap ${(g('JSHeapUsedSize') / 1048576).toFixed(0).padStart(5)} / ${(g('JSHeapTotalSize') / 1048576).toFixed(0).padStart(5)} MB  nodes ${String(g('Nodes')).padStart(7)}  listeners ${String(g('JSEventListeners')).padStart(6)}  renderer RSS ${top?.rss ?? '?'} MB (peak ${top?.hwm ?? '?'}) [${procs.length} renderers]`,
  );
};
const waitFor = async (expr, tries = 300, every = 200) => {
  for (let i = 0; i < tries; i++) {
    if (await evalJs(expr)) return true;
    await sleep(every);
  }
  return false;
};
const clickLauncher = async (name) => {
  await evalJs(
    `[...document.querySelectorAll('button.ze-launcher')].find(e => e.textContent.trim().startsWith(${JSON.stringify(name)}))?.click()`,
  );
  await waitFor(`!document.querySelector('.ze-progress-dialog')`);
  await sleep(2500);
};

await sample('blank tab');
await send('Page.navigate', { url });
await waitFor(
  `document.title.includes('[Read Only]') && !document.querySelector('.ze-progress-dialog')`,
  600,
);
console.log('title:', await evalJs('document.title'));
await sample('manager painted');
await sleep(8000);
await sample('manager + 8 s idle warm-up');
for (const l of ['Schematic Editor', 'PCB Editor', 'Symbol Editor', 'Footprint Editor']) {
  await clickLauncher(l);
  await sample(l);
  await sleep(5000);
  await sample(`${l} + 5 s`);
  // Back to the manager via the frame's own home / window switch.
  await evalJs(`document.querySelector('[data-testid="home"], .ze-home-btn')?.click()`);
  await sleep(500);
}
await sleep(10000);
await sample('after all four, 10 s later');
console.log('final URL', await evalJs('location.href'));
chrome.kill();
