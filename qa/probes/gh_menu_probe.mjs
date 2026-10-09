// File > Open Project from GitHub... (#640), signed out, in headless Chrome: the link
// dialog, then the chooser for a repository with several projects; screenshots.
//   PROF=$(mktemp -d) node --experimental-websocket qa/probes/gh_menu_probe.mjs http://localhost:5180/ https://github.com/<owner>/<repo>
// The board->screen map comes from hovering two points and reading the status bar's X/Y.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const [url, link] = process.argv.slice(2);
const port = 9353;
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
    `${process.env.HOME}/probes_tmp/gh_menu_${name}.png`,
    Buffer.from(result.data, 'base64'),
  );
};
const clickText = (sel, text) =>
  evalJs(
    `(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`,
  );
await send('Page.navigate', { url });
await sleep(5000);
console.log('File menu', await clickText('.ze-menubar *', 'File'));
await sleep(500);
console.log('item', await clickText('.ze-dropdown *', 'Open Project from GitHub...'));
await sleep(800);
await shot('dialog');
// Type the link the way a person pastes it: set the value React tracks, then input.
console.log(
  'typed',
  await evalJs(`(() => { const i = document.querySelector('.ze-textentry-ctrl'); if (!i) return false;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(i, ${JSON.stringify(link)}); i.dispatchEvent(new Event('input', { bubbles: true })); return i.value; })()`),
);
console.log('ok', await clickText('.ze-modal button', 'OK'));
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  if (
    await evalJs(
      `!!document.querySelector('[aria-label="Open Project from GitHub"] .ze-choice-list, .ze-single-choice, [role=listbox]')`,
    )
  )
    break;
}
await shot('chooser');
console.log(
  'choices',
  await evalJs(
    `[...document.querySelectorAll('[role=option], .ze-choice-row')].map((e) => e.textContent.trim()).join(' | ')`,
  ),
);
console.log('pick', await clickText('.ze-modal button', 'OK'));
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  if ((await evalJs('location.pathname')).includes('/tree/')) break;
}
await sleep(1500);
console.log('url', await evalJs('location.pathname'));
console.log('title', await evalJs('document.title'));
await shot('opened');
for (const l of logs) console.log(l);
chrome.kill();
process.exit(0);
