// Zoom smoothness in the PCB Editor, from headless Chrome over CDP.
//
//   PROF=$(mktemp -d) node qa/probes/pcb_zoom_probe.mjs http://localhost:5180/demo/ecc83
//
// Opens the PCB Editor from the project manager, then scrolls the wheel over
// the canvas at 60 Hz for 2 s. Reports the frame intervals while it does
// (rAF timestamps: a smooth zoom is ~16.7 ms every frame) and where the main
// thread spent its time (CPU profile, self time per function and per file).
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const [url] = process.argv.slice(2);
const port = 9341;
const chrome = spawn(
  '/usr/bin/google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    ...(process.env.SWIFTSHADER ? ['--enable-unsafe-swiftshader'] : ['--use-angle=gl']),
    '--window-size=1600,1000',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${process.env.PROF}`,
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore', env: { ...process.env, DISPLAY: ':0' } },
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
await send('Page.navigate', { url });
for (let i = 0; i < 150; i++) {
  await sleep(200);
  if (
    await evalJs(
      `document.body.innerText.includes('.kicad_pro') && !!document.querySelector('button.ze-launcher') && !document.querySelector('.ze-progress-dialog')`,
    )
  )
    break;
}
await sleep(6000);
await evalJs(
  `[...document.querySelectorAll('button.ze-launcher')].find(e => e.textContent.trim().startsWith('PCB Editor')).click()`,
);
// The editor's canvas, laid out and visible.
let rect = null;
for (let i = 0; i < 300; i++) {
  await sleep(200);
  rect = await evalJs(
    `(() => { const at = (x, y) => document.elementFromPoint(x, y); const c = [...document.querySelectorAll('canvas')].filter(c => { const r = c.getBoundingClientRect(); if (r.width < 400 || r.height < 300) return false; const cx = r.x + r.width/2, cy = r.y + r.height/2; const hit = at(cx, cy); return hit === c || (hit && c.parentElement && c.parentElement.contains(hit)); }).sort((a,b) => b.width*b.height - a.width*a.height)[0]; if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height }; })()`,
  );
  if (rect) break;
}
if (!rect) {
  console.log('no canvas found');
  console.log(
    await evalJs(
      `JSON.stringify({ url: location.href, text: document.body.innerText.slice(0, 400), launchers: [...document.querySelectorAll('button.ze-launcher')].map(b => b.textContent.trim().slice(0, 30)), canvases: [...document.querySelectorAll('canvas')].map(c => [c.width, c.height, getComputedStyle(c).visibility]) })`,
    ),
  );
  chrome.kill();
  process.exit(1);
}
for (let i = 0; i < 600; i++) {
  await sleep(500);
  if (!(await evalJs(`document.body.innerText.includes('Load PCB')`))) break;
}
await sleep(3000);
{
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync(
    process.env.SHOT ?? '/tmp/zoom_probe.png',
    Buffer.from(shot.result.data, 'base64'),
  );
  console.log('canvas', JSON.stringify(rect));
}
await evalJs(
  `(() => { window.__frames = []; const tick = (t) => { window.__frames.push(t); if (window.__frames.length < 100000) requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()`,
);
await send('Profiler.setSamplingInterval', { interval: 200 });
await send('Profiler.start');
const t0 = await evalJs('performance.now()');
for (let i = 0; i < 120; i++) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: rect.x + (i % 10) * 3,
    y: rect.y,
    deltaX: 0,
    deltaY: i < 60 ? -100 : 100,
  });
  await sleep(16);
}
await sleep(500);
const t1 = await evalJs('performance.now()');
const { result } = await send('Profiler.stop');
const frames = await evalJs(`window.__frames.filter(t => t >= ${t0} && t <= ${t1})`);
const d = frames
  .slice(1)
  .map((t, i) => t - frames[i])
  .sort((a, b) => a - b);
const q = (p) => d[Math.min(d.length - 1, Math.floor(p * d.length))]?.toFixed(1);
console.log(
  `${(t1 - t0).toFixed(0)} ms of wheel: ${frames.length} frames; interval p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} max ${d.at(-1)?.toFixed(1)} ms; frames over 33 ms: ${d.filter((x) => x > 33).length}`,
);
const p = result.profile;
const self = new Map();
const byUrl = new Map();
const nodes = new Map(p.nodes.map((n) => [n.id, n]));
for (let i = 0; i < p.samples.length; i++) {
  const f = nodes.get(p.samples[i]).callFrame;
  const key = `${f.functionName || '(anon)'}  ${(f.url || '').split('/').pop().split('?')[0]}:${f.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + p.timeDeltas[i]);
  const u = (f.url || f.functionName).split('/').pop().split('?')[0] || f.functionName;
  byUrl.set(u, (byUrl.get(u) ?? 0) + p.timeDeltas[i]);
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log(`profiled ${Math.round(total / 1000)} ms; top self-time:`);
for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18))
  console.log(`  ${String(Math.round(v / 1000)).padStart(5)} ms  ${k}`);
console.log(
  'by file:',
  [...byUrl.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => `${k} ${Math.round(v / 1000)}ms`)
    .join(' | '),
);
chrome.kill();
