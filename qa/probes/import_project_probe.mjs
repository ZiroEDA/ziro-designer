// File > Import Non-KiCad Project end to end in headless Chrome, on a dev server
// with auth off (importing creates a project, which needs an account otherwise):
//   PROF=$(mktemp -d) node --experimental-websocket qa/probes/import_project_probe.mjs \
//     http://localhost:5181/ 'EAGLE Project...' file1 [file2 ...]
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const [url, row, ...files] = process.argv.slice(2);
const port = 9355;
const chrome = spawn(
  '/usr/bin/google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--window-size=1469,1080',
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
await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1469,
  height: 1080,
  deviceScaleFactor: 1,
  mobile: false,
  screenWidth: 1920,
  screenHeight: 1080,
});
await send('Page.setInterceptFileChooserDialog', { enabled: true });
let chooser = null;
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Page.fileChooserOpened') chooser = m.params;
});
const { writeFileSync } = await import('node:fs');
const shot = async (name) => {
  const { result } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(
    `${process.env.HOME}/probes_tmp/import_${name}.png`,
    Buffer.from(result.data, 'base64'),
  );
};
const clickText = (sel, text) =>
  evalJs(
    `(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`,
  );
await send('Page.navigate', { url });
await sleep(5000);
console.log('File', await clickText('.ze-menubar *', 'File'));
await sleep(400);
// Hover the submenu row open, then click the format.
await evalJs(
  `(() => { const r = [...document.querySelectorAll('.ze-dropdown *')].find((e) => e.textContent.trim() === 'Import Non-KiCad Project...'); r?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); r?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); r?.click(); return !!r; })()`,
);
await sleep(500);
// A REAL click (Input.dispatchMouseEvent): a file chooser opens only inside a
// user gesture, and a script's element.click() is not one.
const rect = await evalJs(
  `(() => { const r = [...document.querySelectorAll('.ze-dropdown *')].find((e) => e.textContent.trim() === ${JSON.stringify(row)}); if (!r) return null; const b = r.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`,
);
console.log('row at', rect);
if (rect) {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', {
      type,
      x: rect[0],
      y: rect[1],
      button: 'left',
      clickCount: 1,
    });
}
for (let i = 0; i < 20 && !chooser; i++) await sleep(250);
console.log('chooser', !!chooser, chooser?.mode);
if (chooser) await send('DOM.setFileInputFiles', { files, backendNodeId: chooser.backendNodeId });
const t0 = Date.now();
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  const err = await evalJs(
    `(document.querySelector('.ze-modal[role=dialog], [role=alertdialog]')?.innerText || '').slice(0, 300)`,
  );
  if (err && /Error|could not|not supported/i.test(err)) {
    console.log('MESSAGE', err.replace(/\n+/g, ' | '));
    await shot('message');
    await clickText('.ze-modal button, [role=alertdialog] button', 'OK');
  }
  if (/PCB Editor/.test(await evalJs('document.title'))) break;
}
// The message box, then DIALOG_MAP_LAYERS (EAGLE/Altium/CADSTAR imports raise
// it): OK on the TOPMOST dialog each time - the last OK in the document - which
// takes the mapping's automatic answer, as a user accepting the defaults would.
const visibleText = (t) =>
  evalJs(
    `[...document.querySelectorAll('*')].some((e) => e.childElementCount === 0 && e.textContent.includes(${JSON.stringify(t)}) && e.getClientRects().length > 0)`,
  );
for (let i = 0; i < 40; i++) {
  await sleep(500);
  const message = await evalJs(
    `(() => { const e = [...document.querySelectorAll('*')].find((x) => x.childElementCount === 0 && x.tagName !== 'STYLE' && x.tagName !== 'SCRIPT' && x.getClientRects().length > 0 && /cannot be imported|could not|None of the files/.test(x.textContent)); return e ? e.textContent : ''; })()`,
  );
  const mapping = await visibleText('Import Layer Mapping');
  if (!message && !mapping) {
    if (i > 6) break;
    continue;
  }
  if (message) console.log('MESSAGE', message);
  if (mapping) {
    await shot('mapping');
    // DIALOG_MAP_LAYERS refuses OK while a required (*) layer is unmatched and
    // says to click Auto-Match Layers - what a person would do.
    console.log('auto-match', await clickText('button', 'Auto-Match Layers'));
    await sleep(300);
  }
  console.log(
    'OK',
    await evalJs(
      `(() => { const oks = [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'OK' && b.getClientRects().length > 0); const b = oks.at(-1); if (!b) return false; b.click(); return true; })()`,
    ),
  );
}
for (let i = 0; i < 120; i++) {
  await sleep(1000);
  const loading = await evalJs(
    `[...document.querySelectorAll('*')].some((e) => e.childElementCount === 0 && e.textContent === 'Load PCB' && e.getClientRects().length > 0)`,
  );
  if (!loading && i > 3) break;
}
await sleep(3000);
console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, 'title', await evalJs('document.title'));
console.log('url', await evalJs('location.pathname'));
await shot('board');
for (const l of logs) console.log(l);
chrome.kill();
process.exit(0);
