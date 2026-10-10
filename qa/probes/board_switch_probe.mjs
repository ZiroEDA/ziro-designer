// Switch the board editor from one board to another in-app and capture the "Load PCB"
// moment: the canvas under the dialog must be blank, not the previous board.
//   PROF=$(mktemp -d) node --experimental-websocket qa/probes/board_switch_probe.mjs http://localhost:5180/demo/<a>/pcb /demo/<b>/pcb
// The board->screen map comes from hovering two points and reading the status bar's X/Y.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const [url, next] = process.argv.slice(2);
const port = 9354;
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
const { writeFileSync } = await import('node:fs');
const shot = async (name) => {
  const { result } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(
    `${process.env.HOME}/probes_tmp/board_switch_${name}.png`,
    Buffer.from(result.data, 'base64'),
  );
};
const loadingPcb = () =>
  evalJs(
    `[...document.querySelectorAll('*')].some((e) => e.childElementCount === 0 && e.textContent === 'Load PCB' && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden') && /PCB Editor/.test(document.title)`,
  );
await send('Page.navigate', { url });
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  if (i > 8 && !(await loadingPcb()) && /PCB Editor/.test(await evalJs('document.title'))) break;
}
await sleep(2000);
console.log('first', await evalJs('document.title'));
await shot('first');
// In-app navigation, as a link click would do: the frame stays alive.
await evalJs(
  `history.pushState(null, '', ${JSON.stringify(next)}); dispatchEvent(new PopStateEvent('popstate')); true`,
);
let caught = false;
for (let i = 0; i < 600 && !caught; i++) {
  await sleep(100);
  if (await loadingPcb()) {
    await sleep(300);
    await shot('loading');
    caught = true;
  }
}
console.log('caught the Load PCB dialog', caught);
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  if (!(await loadingPcb()) && i > 2) break;
}
await sleep(1500);
console.log('second', await evalJs('document.title'));
await shot('second');
for (const l of logs) console.log(l);
chrome.kill();
process.exit(0);
