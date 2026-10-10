// Signed out in headless Chrome (#639): the app opens straight in, New Project goes to
// the full-page /signup, and Back returns to the app. Screenshots land in ~/probes_tmp/explore_*.png.
//   PROF=$(mktemp -d) node --experimental-websocket qa/probes/explore_probe.mjs http://localhost:5180/
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const [url] = process.argv.slice(2);
const port = 9349;
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
const { writeFileSync } = await import('node:fs');
const shot = async (name) => {
  const { result } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(
    `${process.env.HOME}/probes_tmp/explore_${name}.png`,
    Buffer.from(result.data, 'base64'),
  );
};
const clickText = (sel, text) =>
  evalJs(
    `(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => (e.textContent || '').includes(${JSON.stringify(text)}) || e.title === ${JSON.stringify(text)} || e.getAttribute('aria-label') === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`,
  );
await sleep(6000);
console.log(
  'landed at',
  await evalJs('location.pathname'),
  'wall',
  await evalJs(`!!document.querySelector('.ze-auth-gate')`),
);
await shot('home');
console.log(
  'new project',
  await evalJs(
    `(() => { const b = document.querySelector('.ze-mgrbar button'); b.click(); return b.getAttribute('aria-label'); })()`,
  ),
);
await sleep(1500);
console.log(
  'now at',
  await evalJs('location.pathname'),
  'wall',
  await evalJs(`!!document.querySelector('.ze-auth-gate')`),
);
await shot('newproject');
await send('Runtime.evaluate', { expression: 'history.back()' });
await sleep(3000);
console.log(
  'back at',
  await evalJs('location.pathname'),
  'wall',
  await evalJs(`!!document.querySelector('.ze-auth-gate')`),
);
for (const l of logs) console.log(l);
chrome.kill();
process.exit(0);
