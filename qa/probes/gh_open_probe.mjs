// Open a GitHub project from its address (#640), signed out, in headless Chrome:
// report the title, the project tree, any alert (an open error), and screenshot.
//   PROF=$(mktemp -d) node --experimental-websocket qa/probes/gh_open_probe.mjs http://localhost:5180/gh/<owner>/<repo>[/-/pcb]
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const [url] = process.argv.slice(2);
const port = 9352;
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
const dialogs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Page.javascriptDialogOpening') {
    dialogs.push(m.params.message);
    send('Page.handleJavaScriptDialog', { accept: true });
  }
});
const t0 = Date.now();
await send('Page.navigate', { url });
let last = '';
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  const t = await evalJs('document.title');
  const busy = await evalJs(`!!document.querySelector('.ze-progress, [role=progressbar]')`);
  if (t !== last) console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s title: ${t}`);
  last = t;
  if (dialogs.length || (!busy && i > 3 && /GitHub|\\.kicad|Editor/.test(t))) break;
}
// Then the frame's own load: the board editor's "Load PCB" dialog.
for (let i = 0; i < 120; i++) {
  if (!(await evalJs(`document.body.innerText.includes('Load PCB')`))) break;
  await sleep(1000);
}
console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s loaded`);
await sleep(2000);
console.log('url', await evalJs('location.pathname'));
console.log(
  'tree',
  await evalJs(
    `[...document.querySelectorAll('.ze-projecttree .ze-panel-body *')].map((e) => e.childElementCount === 0 ? e.textContent.trim() : '').filter(Boolean).slice(0, 12).join(' | ')`,
  ),
);
console.log(
  'strip',
  await evalJs(`(document.querySelector('.ze-readonly-infobar .msg') || {}).textContent || ''`),
);
for (const d of dialogs) console.log('ALERT', d);
for (const l of logs) console.log(l);
const { writeFileSync } = await import('node:fs');
const { result } = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${process.env.HOME}/probes_tmp/gh_open.png`, Buffer.from(result.data, 'base64'));
chrome.kill();
process.exit(0);
