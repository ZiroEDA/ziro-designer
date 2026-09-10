// Where a first open spends its time, from headless Chrome over CDP.
//
// Opens a project URL on a built copy (see editor_open_timeline.mjs for the
// build and the server), waits for the idle prefetch, then CPU-profiles a
// launcher click until the editor's OWN frame is painted — its status bar
// visible at computed style, checked once per animation frame, never via
// innerText (which forces layout and skews what it measures). Run twice on
// one profile: a cold visit and a warm one with the worker installed.
//
//   PROF=$S/prof node --experimental-websocket qa/probes/profile_editor_open.mjs \
//       http://localhost:4174/demo/ecc83 "PCB Editor"
//
// What it found (2026-09-10, ecc83 demo, swiftshader): click -> painted frame
// 420-700 ms with every chunk on disk, almost all of it `(program)` — the
// frame's first layout, the GL context and shaders, and 26 toolbar icons plus
// the font atlas that nothing requests until the frame paints. Pre-mounting
// the frames hidden (display:none, visibility:hidden, content-visibility:
// hidden — all three tried) measured WORSE, 950-1640 ms, because a launcher
// click bumps `openNonce` and every mounted editor reloads the project on it.
// Making a same-project open not reload is the prerequisite for any warming.
// CPU-profile a launcher click on a WARM profile (second visit: worker
// installed, every chunk on disk), and say where the time between the click
// and the frame goes.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const [url, launcher] = process.argv.slice(2);
const port = 9334;
const chrome = spawn(
  '/usr/bin/google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
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
await send('Profiler.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
const open = async (label) => {
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
  // Let the idle prefetch finish: every editor chunk imported and evaluated.
  await sleep(4000);
  const resBefore = await evalJs(`performance.getEntriesByType('resource').length`);
  await send('Profiler.setSamplingInterval', { interval: 200 });
  await send('Profiler.start');
  const t0 = await evalJs(
    `(() => { window.__t0 = performance.now(); window.__frameAt = null; const want = ${JSON.stringify(launcher)}.startsWith('PCB') ? 'pcb' : ${JSON.stringify(launcher)}.startsWith('Schematic') ? 'schematic' : 'symbols'; const painted = () => [...document.querySelectorAll('.ze-app')].some(r => r.querySelector('.ze-statusbar') && (want !== 'schematic' || r.classList.contains('sch-theme')) && (want === 'schematic' || !r.classList.contains('sch-theme')) && !r.querySelector('.ze-launcher') && getComputedStyle(r).visibility === 'visible'); const tick = () => { if (painted()) { setTimeout(() => { window.__frameAt = performance.now(); }, 0); return; } requestAnimationFrame(tick); }; requestAnimationFrame(tick); [...document.querySelectorAll('button.ze-launcher')].find(e => e.textContent.trim().startsWith(${JSON.stringify(launcher)})).click(); return window.__t0; })()`,
  );
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    if (await evalJs('window.__frameAt !== null')) break;
  }
  const { result } = await send('Profiler.stop');
  const frameAt = await evalJs('window.__frameAt');
  const fetched = await evalJs(
    `performance.getEntriesByType('resource').slice(${resBefore}).map(r => r.name.split('/').pop() + ' ' + Math.round(r.duration) + 'ms').join(', ')`,
  );
  console.log(
    `\n== ${label}: click -> frame ${Math.round(frameAt - t0)} ms; fetched during it: ${fetched || '(nothing)'}`,
  );
  // Self time per (function, file) over the click->frame window.
  const p = result.profile;
  const self = new Map();
  const byUrl = new Map();
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const dt = p.timeDeltas;
  let t = p.startTime;
  const tEnd = p.startTime + (frameAt - t0) * 1000 + 0;
  for (let i = 0; i < p.samples.length; i++) {
    t += dt[i];
    const n = nodes.get(p.samples[i]);
    const f = n.callFrame;
    const key = `${f.functionName || '(anon)'}  ${(f.url || '').split('/').pop()}:${f.lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + dt[i]);
    const u = (f.url || f.functionName).split('/').pop() || f.functionName;
    byUrl.set(u, (byUrl.get(u) ?? 0) + dt[i]);
  }
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  console.log(`profiled ${Math.round(total / 1000)} ms of samples; top self-time:`);
  for (const [k, v] of top) console.log(`  ${String(Math.round(v / 1000)).padStart(5)} ms  ${k}`);
  console.log(
    'by file:',
    [...byUrl.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k, v]) => `${k} ${Math.round(v / 1000)}ms`)
      .join(' | '),
  );
};
await open('first visit (cold profile)');
await open('second visit (warm: worker + chunks on disk)');
chrome.kill();
