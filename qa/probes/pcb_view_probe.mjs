// Screenshot a board region at a stated scale, then again with named layers
// and object classes hidden, for pixel comparison against a KiCad capture.
//
//   SHOTS=dir node --experimental-websocket qa/probes/pcb_view_probe.mjs \
//       "http://localhost:4174/demo/cm5_minima?perf=1" 113.15 29.35 58 F.Mask F.Paste Zones
//
// Arguments: the demo MANAGER page, the view centre (mm), the scale in screen
// pixels per mm (measure it off the other capture), then the Appearance rows to hide in turn (a layer name, or an
// Objects-tab label such as Zones / Pads / Footprints), each one a shot.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [url, cx, cy, scale, ...hides] = process.argv.slice(2);
const port = 9337;
const chrome = spawn(
  '/usr/bin/google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--use-angle=vulkan',
    '--enable-features=Vulkan',
    '--ignore-gpu-blocklist',
    '--window-size=1920,1100',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${process.env.PROF ?? '/tmp/pcb_view_probe'}`,
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore', env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':0' } },
);
process.on('uncaughtException', (e) => {
  console.error(e);
  chrome.kill();
  process.exit(1);
});
await sleep(3000);
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const consoleLines = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) pending.get(m.id)(m);
  else if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    consoleLines.push([performance.now(), text]);
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
const waitFor = async (label, expression, timeoutMs) => {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    if (await evalJs(expression)) return;
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${label}`);
};
const waitForLine = async (label, re, timeoutMs, after = 0) => {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    const hit = consoleLines.find(([t, s]) => t > after && re.test(s));
    if (hit) return hit;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label}`);
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${process.env.SHOTS ?? '.'}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  console.log(`  shot ${name}`);
};

await send('Page.enable');
await send('Runtime.enable');
const origin = new URL(url).origin;
await send('Page.navigate', { url: `${origin}/` });
await sleep(1500);
await evalJs(`localStorage.setItem('KICAD_TRACE','KICAD_GAL_PROFILE'); 'ok'`);
await send('Page.navigate', { url });
await waitFor('the demo project', `document.body.innerText.includes('.kicad_pcb')`, 120000);
await sleep(1000);
await evalJs(
  `(() => { const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'PCB Editor'); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!el; })()`,
);
await waitForLine('first frame', /View timing/, 300000);
// The load's own Zoom to Fit lands after the first frame; set the view after it.
await sleep(12000);

const view = async () =>
  evalJs(`(() => {
    const p = window.__pcbPerf.panel; const v = p.GetView();
    // The stated number is SCREEN PIXELS PER MM, which is what a capture of
    // the other side measures; the VIEW scale that gives it follows.
    const s0 = v.GetScale();
    const d = v.ToScreen({ x: 1e6, y: 0 }).x - v.ToScreen({ x: 0, y: 0 }).x;
    v.SetScale(s0 * ${scale} / d); v.SetCenter({ x: ${cx} * 1e6, y: ${cy} * 1e6 });
    p.GetView().MarkDirty(); p.Refresh();
    return 'scale ' + v.GetScale() + ' (' + (v.ToScreen({ x: 1e6, y: 0 }).x - v.ToScreen({ x: 0, y: 0 }).x).toFixed(1) + ' px/mm) center ' + JSON.stringify(v.GetCenter());
  })()`);
console.log(await view());
await sleep(1500);
if (process.env.CHECK) console.log('  check:', await evalJs(process.env.CHECK));
await shot('all');

const hide = async (label) =>
  evalJs(`(() => {
    // A bare number is a VIEW layer id, hidden on the VIEW directly.
    if (/^\\d+$/.test(${JSON.stringify(label)})) {
      const v = window.__pcbPerf.panel.GetView();
      v.SetLayerVisible(Number(${JSON.stringify(label)}), false);
      return 'hid view layer ' + ${JSON.stringify(label)};
    }
    const rows = [...document.querySelectorAll('.ze-layer-row, .ze-object-row')];
    const row = rows.find(r => r.textContent.trim().startsWith(${JSON.stringify(label)}));
    if (!row) {
      // maybe on the Objects tab
      const tab = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'Objects');
      if (tab) tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return 'switched to Objects';
    }
    const eye = row.querySelector('.ze-eye-btn');
    eye.click();
    const v = window.__pcbPerf.panel.GetView();
    return 'hid ' + ${JSON.stringify(label)} + '; F.Mask(1) visible ' + v.IsLayerVisible(1) + ' F.Paste(13) ' + v.IsLayerVisible(13) + ' row eye ' + eye.outerHTML.slice(0, 120);
  })()`);

for (const h of hides) {
  let r = await hide(h);
  if (r === 'switched to Objects') {
    await sleep(500);
    r = await hide(h);
  }
  console.log(`  ${r}`);
  await sleep(1000);
  await view();
  await sleep(1500);
  await shot(`without_${h.replace(/\W/g, '_')}`);
}
chrome.kill();
