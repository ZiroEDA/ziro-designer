// Move a footprint with the mouse (click, M, drag, click) and screenshot before/after,
// to see whether the cached GL drawing follows the board item.
//   SHOTDIR=<dir> SWIFTSHADER=1 PROF=$(mktemp -d) node --experimental-websocket qa/probes/pcb_move_probe.mjs <url>
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
const port = 9347;
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

for (let i = 0; i < 900; i++) {
  await sleep(500);
  if (
    (await evalJs(`document.title.includes('PCB Editor')`)) &&
    !(await evalJs(`document.body.innerText.includes('Load PCB')`))
  )
    break;
}
await sleep(3000);
const fs = await import('node:fs');
const shot = async (n) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${process.env.SHOTDIR}/${n}.png`, Buffer.from(s.result.data, 'base64'));
};
const X = Number(process.env.PX),
  Y = Number(process.env.PY);
const mouse = (type, x, y, extra = {}) =>
  send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1,
    ...extra,
  });
const move = (x, y) =>
  send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
const key = async (k, code) => {
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: k,
    code,
    windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0),
    text: k,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: k,
    code,
    windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0),
  });
};
await shot('0_loaded');
await move(X, Y);
await sleep(300);
await mouse('mousePressed', X, Y);
await mouse('mouseReleased', X, Y);
await sleep(1500);
await shot('1_selected');
await key('m', 'KeyM');
await sleep(800);
for (let i = 1; i <= 20; i++) {
  await move(X - i * 10, Y + i * 4);
  await sleep(150);
}
await sleep(800);
await shot('2_dragging');
await mouse('mousePressed', X - 200, Y + 80);
await mouse('mouseReleased', X - 200, Y + 80);
await sleep(1500);
await send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: 'Escape',
  code: 'Escape',
  windowsVirtualKeyCode: 27,
});
await send('Input.dispatchKeyEvent', {
  type: 'keyUp',
  key: 'Escape',
  code: 'Escape',
  windowsVirtualKeyCode: 27,
});
await sleep(2000);
await shot('3_after');
console.log('errors', await evalJs(`JSON.stringify((window.__errs||[]).slice(0,5))`));
chrome.kill();
