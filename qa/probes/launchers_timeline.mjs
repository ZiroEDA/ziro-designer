// First open of EVERY launcher: click -> that frame painted, one fresh page
// per launcher, after waiting for the idle warm-up (all nine .ze-app roots
// present) to finish. Build and serve as for editor_open_timeline.mjs; run on
// the real GPU:
//
//   DISPLAY=:0 PROF=$S/prof node --experimental-websocket qa/probes/launchers_timeline.mjs \
//       http://localhost:4174/demo/ecc83
//
// Take the MINIMUM over several runs: the number is what the click costs
// when nothing else is running, and everything else running only adds.
// "warm never" means the warm-up did not finish in 15 s — the machine was
// saturated, and the row is not a measurement.
//
// 2026-09-10, load average 7-9 (another session building), min of 4 runs, ms:
//   Schematic 46  Symbol 89  PCB 72  Footprint 113  Gerber 47  Image 26
//   Calculator 65  Drawing Sheet 38.   Before any of this: ~600 for the two
//   big frames.
// First open of every launcher, click -> its frame painted, one fresh page each.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const [url] = process.argv.slice(2);
const LAUNCHERS = [
  'Schematic Editor',
  'Symbol Editor',
  'PCB Editor',
  'Footprint Editor',
  'Gerber Viewer',
  'Image Converter',
  'Calculator Tools',
  'Drawing Sheet Editor',
];
const port = 9337;
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
  { stdio: 'ignore' },
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
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
const out = [];
for (const launcher of LAUNCHERS) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    if (
      await evalJs(
        `document.body.innerText.includes('.kicad_pro') && !document.querySelector('.ze-progress-dialog')`,
      )
    )
      break;
  }
  // How long until every frame exists (the warm-up), then a beat more.
  const tw = Date.now();
  let warmed = 'never';
  for (let i = 0; i < 150; i++) {
    await sleep(100);
    const n = await evalJs(
      `[...document.querySelectorAll('.ze-app')].filter(r => r.children.length > 0).length`,
    );
    if (n >= 9) {
      warmed = String(Date.now() - tw);
      break;
    }
  }
  await sleep(1000);
  const t0 = await evalJs(`(() => { window.__t0 = performance.now(); window.__frameAt = null;
    const painted = () => [...document.querySelectorAll('.ze-app')].some(r => !r.querySelector('.ze-launcher') && r.children.length > 0 && r.children.length > 0 && r.checkVisibility({ visibilityProperty: true }) && r.getBoundingClientRect().height > 100);
    const tick = () => { if (painted()) { setTimeout(() => { window.__frameAt = performance.now(); }, 0); return; } requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    [...document.querySelectorAll('button.ze-launcher')].find(e => e.textContent.trim().startsWith(${JSON.stringify(launcher)})).click(); return window.__t0; })()`);
  for (let i = 0; i < 100; i++) {
    await sleep(50);
    if (await evalJs('window.__frameAt !== null')) break;
  }
  const frameAt = await evalJs('window.__frameAt');
  out.push(`${launcher}: ${frameAt ? Math.round(frameAt - t0) : 'n/a'} (warm ${warmed})`);
}
console.log(out.join(' | '));
chrome.kill();
