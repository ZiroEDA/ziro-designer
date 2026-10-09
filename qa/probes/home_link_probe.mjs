// The ZiroEDA logo in an editor on a demo: does it reach the manager and stay there?
//
//   PROF=$(mktemp -d) SWIFTSHADER=1 node --experimental-websocket qa/probes/home_link_probe.mjs http://localhost:5181/demo/ecc83
//
// (was: Zoom smoothness in the PCB Editor, from headless Chrome over CDP.
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
const port = 9345;
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

for (let i = 0; i < 600; i++) {
  await sleep(500);
  if (
    (await evalJs(`document.title.includes('PCB Editor')`)) &&
    !(await evalJs(`document.body.innerText.includes('Load PCB')`))
  )
    break;
}
await sleep(2000);
const state = () =>
  evalJs(
    `JSON.stringify({ path: location.pathname, downloading: document.body.innerText.includes('Downloading demo'), title: document.title })`,
  );
console.log('before click', await state());
console.log(
  'clicked',
  await evalJs(
    `(() => { const l = [...document.querySelectorAll('.ze-home-link:not(.ze-home-link-static)')].filter(e => { const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit && e.contains(hit); }); if (!l.length) return 'no visible home link'; l[0].click(); return 'ok'; })()`,
  ),
);
for (let i = 0; i < 24; i++) {
  await sleep(500);
  console.log(`t+${(i + 1) * 0.5}s`, await state());
}
chrome.kill();
