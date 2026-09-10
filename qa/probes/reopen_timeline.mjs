// Open the schematic, File > Close, open the board, close, open each again:
// for every open, whether a progress dialog appeared (a load) and the time
// from the click to the editor's own frame being painted.
//
// Runs on the machine's real GPU (`--use-angle=gl`): headless Chrome's
// default is SwiftShader, which renders a full-viewport WebGL frame in
// ~700 ms and drowns everything else. Build and serve as for
// editor_open_timeline.mjs, then:
//
//   DISPLAY=:0 PROF=$S/prof node --experimental-websocket qa/probes/reopen_timeline.mjs \
//       http://localhost:4174/demo/ecc83
//
// The frame is "painted" when its own status bar passes checkVisibility()
// — false under display:none, content-visibility:hidden and visibility:hidden
// alike, so a hidden-but-mounted frame cannot satisfy it. Set `profile.on`
// before an open to trace it and total the timeline events by name.
//
// Measured 2026-09-10 on ecc83 (sch, pcb, sch-reopen, pcb-reopen), ms:
//   before:                       ~620  ~590  ~250  ~235   reopens re-read the project
//   raise + persistent frames:    ~700  ~480   31-52 31-55 no dialog on reopen
//   + frames warmed at idle:       95-136 70-142 39-82 45-90
// Open the schematic, go home, open the board, go home, open the schematic
// again. For each open: did a progress dialog appear (a load), and how long
// from the click to the frame being painted?
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const [url] = process.argv.slice(2);
const port = 9334;
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
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.args[0]?.value === 'raiseOrOpen')
    console.log('  LOG', m.params.args[1]?.value);
});
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
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
await sleep(3000);
const profile = { on: false };
const open = async (launcher, want) => {
  const events = [];
  if (profile.on) {
    ws.addEventListener('message', function h(e) {
      const m = JSON.parse(e.data);
      if (m.method === 'Tracing.dataCollected') events.push(...m.params.value);
      if (m.method === 'Tracing.tracingComplete') profile.done = true;
    });
    await send('Tracing.start', {
      categories: 'devtools.timeline,disabled-by-default-devtools.timeline',
      transferMode: 'ReportEvents',
    });
  }
  const t0 =
    await evalJs(`(() => { window.__t0 = performance.now(); window.__frameAt = null; window.__dialogs = []; new MutationObserver(() => { const d = document.querySelector('.ze-progress-dialog'); if (d) window.__dialogs.push(d.textContent); }).observe(document.body, { childList: true, subtree: true, characterData: true });
    const painted = () => [...document.querySelectorAll('.ze-app')].some(r => r.querySelector('.ze-statusbar') && (${JSON.stringify(want)} !== 'schematic' || r.classList.contains('sch-theme')) && (${JSON.stringify(want)} === 'schematic' || !r.classList.contains('sch-theme')) && !r.querySelector('.ze-launcher') && r.checkVisibility({ visibilityProperty: true }));
    const tick = () => { if (painted()) { setTimeout(() => { window.__frameAt = performance.now(); }, 0); return; } requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    [...document.querySelectorAll('button.ze-launcher')].find(e => e.textContent.trim().startsWith(${JSON.stringify(launcher)})).click(); return window.__t0; })()`);
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    if (await evalJs('window.__frameAt !== null')) break;
  }
  // let any load finish
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    if (!(await evalJs(`!!document.querySelector('.ze-progress-dialog')`))) break;
  }
  const frameAt = await evalJs('window.__frameAt');
  const dialogs = await evalJs('JSON.stringify([...new Set(window.__dialogs)])');
  console.log(`${launcher}: click -> frame ${Math.round(frameAt - t0)} ms; dialogs: ${dialogs}`);
  if (profile.on) {
    profile.done = false;
    await send('Tracing.end');
    for (let i = 0; i < 100 && !profile.done; i++) await sleep(100);
    const byName = new Map();
    let total = 0;
    for (const ev of events) {
      if (ev.ph !== 'X' || !ev.dur) continue;
      byName.set(ev.name, (byName.get(ev.name) ?? 0) + ev.dur);
    }
    // Only top-level-ish events matter; nested ones double count, so show the usual suspects.
    for (const n of [
      'FunctionCall',
      'EvaluateScript',
      'UpdateLayoutTree',
      'Layout',
      'PrePaint',
      'Paint',
      'Commit',
      'RunTask',
      'TimerFire',
      'Animation Frame Fired',
      'FireAnimationFrame',
      'ResizeObserver',
      'HitTest',
      'v8.compile',
      'MinorGC',
      'MajorGC',
      'GPUTask',
      'RasterTask',
      'ImageDecodeTask',
      'Decode Image',
      'XHRLoad',
      'ResourceReceivedData',
    ])
      if (byName.has(n))
        console.log(`    ${String(Math.round(byName.get(n) / 1000)).padStart(6)} ms  ${n}`);
    const top = [...byName.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => `${k}=${Math.round(v / 1000)}`)
      .join(' ');
    console.log('    top:', top);
  }
};
const home = async () => {
  // File > Close on the frame on screen (ACTIONS::quit -> onExitToHome).
  const r1 = await evalJs(
    `(() => { const bar = [...document.querySelectorAll('.ze-menubar')].find(b => getComputedStyle(b).visibility === 'visible' && b.closest('.ze-app') && !b.closest('.ze-app').querySelector('.ze-launcher')); if (!bar) return 'no bar'; const file = [...bar.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'File'); if (!file) return 'no File'; file.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); file.click(); return 'ok'; })()`,
  );
  await sleep(300);
  const r2 = await evalJs(
    `(() => { const item = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'Close' && getComputedStyle(e).visibility === 'visible'); if (!item) return 'no Close'; item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); item.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); item.click(); return 'clicked'; })()`,
  );
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    if (await evalJs(`!!document.querySelector('button.ze-launcher')`)) break;
  }
  await sleep(500);
  console.log(
    '  home?',
    r1,
    r2,
    await evalJs(
      `document.body.dataset.activeView + ' launchers=' + document.querySelectorAll('button.ze-launcher').length`,
    ),
  );
};
await open('Schematic Editor', 'schematic');
await home();
await open('PCB Editor', 'pcb');
await home();
await open('Schematic Editor', 'schematic');
await home();
await open('PCB Editor', 'pcb');
chrome.kill();
