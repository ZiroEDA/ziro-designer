// Click a board point in the PCB Editor from headless Chrome and report what the selection
// tool collected (its ZDBG console lines, when instrumented) and what ended up selected.
//   PROF=$(mktemp -d) node qa/probes/pcb_click_probe.mjs <url> <xmm> <ymm>
// The board->screen map comes from hovering two points and reading the status bar's X/Y.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const [url, xmm, ymm] = process.argv.slice(2);
const port = 9348;
const chrome = spawn(
  '/usr/bin/google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--window-size=1469,812',
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
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) pending.get(m.id)(m);
  else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push('EXC ' + (d.exception?.description ?? d.text).slice(0, 2500));
  } else if (m.method === 'Runtime.consoleAPICalled') {
    const t = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (t.includes('ZDBG') || process.env.ALLLOGS) logs.push(t.slice(0, 300));
  }
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
  width: 1469,
  height: 812,
  deviceScaleFactor: 1,
  mobile: false,
  screenWidth: 1920,
  screenHeight: 1080,
});
await send('Page.navigate', { url });
// Signed out: the wall's "Explore without an account" (#639) lets the probe in.
for (let i = 0; i < 60; i++) {
  await sleep(500);
  const clicked = await evalJs(
    `(() => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent.includes('Explore without an account')); if (b) { b.click(); return true; } return false; })()`,
  );
  if (clicked) {
    console.log('explore: clicked, now at', await evalJs('location.pathname'));
    break;
  }
  if (await evalJs(`document.querySelectorAll('canvas').length > 0`)) break;
}
for (let i = 0; i < 240; i++) {
  await sleep(500);
  if (
    await evalJs(
      `document.title.includes('PCB Editor') && !document.body.innerText.includes('Load PCB')`,
    )
  )
    break;
}
await sleep(4000);
const mouse = (type, x, y, extra = {}) =>
  send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra });
const status = () =>
  evalJs(
    `(document.body.innerText.match(/X\\s+(-?[\\d.]+)\\s+Y\\s+(-?[\\d.]+)/) || []).slice(1).map(Number)`,
  );
{
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync(
    process.env.HOME + '/probes_tmp/click_probe.png',
    Buffer.from(shot.result.data, 'base64'),
  );
}
console.log(
  'title',
  await evalJs('document.title'),
  'canvases',
  await evalJs(`document.querySelectorAll('canvas').length`),
  'url',
  await evalJs('location.href'),
);
// canvas centre region
const box = await evalJs(
  `(() => { const c = [...document.querySelectorAll('canvas')].sort((a,b)=>b.width*b.height-a.width*a.height)[0]; const r = c.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`,
);
const p1 = [box[0] + box[2] * 0.3, box[1] + box[3] * 0.3];
const p2 = [box[0] + box[2] * 0.7, box[1] + box[3] * 0.7];
await mouse('mouseMoved', ...p1);
await sleep(400);
const w1 = await status();
await mouse('mouseMoved', ...p2);
await sleep(400);
const w2 = await status();
const sx = (p2[0] - p1[0]) / (w2[0] - w1[0]);
const sy = (p2[1] - p1[1]) / (w2[1] - w1[1]);
const px = p1[0] + (Number(xmm) - w1[0]) * sx;
const py = p1[1] + (Number(ymm) - w1[1]) * sy;
await mouse('mouseMoved', px, py);
await sleep(400);
console.log('hover at', px.toFixed(1), py.toFixed(1), 'status', await status());
for (let k = 0; k < Number(process.env.CLICKS ?? 1); k++) {
  await mouse('mousePressed', px, py, { clickCount: 1, buttons: 1 });
  await sleep(60);
  await mouse('mouseReleased', px, py, { clickCount: 1, buttons: 0 });
  await sleep(1500);
  console.log(
    'after click',
    k + 1,
    'PROPS:',
    await evalJs(
      `(document.body.innerText.match(/\\d+ objects selected|No objects selected/)||[''])[0]`,
    ),
  );
}
console.log(logs.join('\n'));
console.log(
  'PANEL:',
  await evalJs(
    `[...document.querySelectorAll('.ze-msgpanel-item')].map(e=>e.innerText.replace(/\\n/g,' / ')).join(' | ')`,
  ),
);
console.log(
  'PROPS:',
  await evalJs(
    `(document.body.innerText.match(/\\d+ objects selected|No objects selected|[^\\n]*selected/)||[''])[0]`,
  ),
);
chrome.kill();
process.exit(0);
