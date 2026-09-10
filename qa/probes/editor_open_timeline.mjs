// What is on screen while an editor opens, from headless Chrome over CDP.
//
// Opens a project URL on a built copy of the app, clicks a launcher, and logs
// at every DOM change whether the editor FRAME is up and whether the progress
// dialog is — so "the frame comes first, then the dialog over it, then the
// board" is a sequence with timestamps rather than a claim. Also saves a
// screenshot every ~50 ms into $OUT.
//
// The sign-in wall blocks a fresh profile, so build a copy with no Supabase
// keys first:
//
//   mkdir -p $S/env && grep -v SUPABASE designer/.env.production > $S/env/.env.production
//   (cd designer && pnpm exec vite build --envDir $S/env --outDir $S/dist-noauth)
//   node qa/probes/serve_spa.mjs $S/dist-noauth 4174 &
//   PROF=$S/prof OUT=$S/shots node --experimental-websocket qa/probes/editor_open_timeline.mjs \
//       http://localhost:4174/demo/ecc83 "PCB Editor" pcb 4000
//
// (`vite preview --outDir` does not honour the directory; hence serve_spa.)
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const [url, launcher, prefix, ms] = process.argv.slice(2);
const port = 9334;
const chrome = spawn(
  '/usr/bin/google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--window-size=1600,1000',
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
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Page.navigate', { url });
// Wait for the project to be open: the tree names a .kicad_pro and no dialog is up.
for (let i = 0; i < 100; i++) {
  await sleep(200);
  const ok = await evalJs(
    `document.body.innerText.includes('.kicad_pro') && !document.querySelector('.ze-progress-dialog')`,
  );
  if (ok) break;
}
await sleep(500);
// A MutationObserver, armed before the click, logs what is on screen at every
// DOM change: is the editor frame there, and is the progress dialog up.
await evalJs(
  `(() => { window.__log = []; const t0 = performance.now(); const snap = () => { const frame = !!document.querySelector('.ze-app .ze-menubar') && (document.body.innerText.includes('Appearance') || document.body.innerText.includes('Hierarchy')); const dlg = document.querySelector('.ze-progress-dialog'); window.__log.push([Math.round(performance.now() - t0), frame, dlg ? dlg.textContent : null]); }; new MutationObserver(snap).observe(document.body, { childList: true, subtree: true, characterData: true }); snap(); return 'armed'; })()`,
);
const clicked = await evalJs(
  `(() => { const el = [...document.querySelectorAll('button.ze-launcher')].find(e => e.textContent.trim().startsWith(${JSON.stringify(launcher)}) && e.querySelector('img,svg,canvas,.ze-launcher-icon')); if (!el) return 'none'; el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); el.click(); return el.tagName + '.' + el.className; })()`,
);
console.log('clicked', clicked);
const t0 = Date.now();
for (let i = 0; Date.now() - t0 < Number(ms); i++) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (!r.result) {
    await sleep(50);
    continue;
  }
  writeFileSync(
    `${process.env.OUT}/${prefix}-${String(i).padStart(2, '0')}-${Date.now() - t0}ms.png`,
    Buffer.from(r.result.data, 'base64'),
  );
  await sleep(50);
}
const log = await evalJs('JSON.stringify(window.__log)');
const seen = [];
for (const e of JSON.parse(log)) {
  const k = e[1] + '|' + e[2];
  if (seen.length === 0 || seen[seen.length - 1].k !== k)
    seen.push({ k, t: e[0], frame: e[1], dialog: e[2] });
}
for (const e of seen)
  console.log(
    String(e.t).padStart(6) + ' ms  frame=' + e.frame + '  dialog=' + JSON.stringify(e.dialog),
  );
console.log(
  'title',
  await evalJs('document.title'),
  '| dialog',
  await evalJs(`document.querySelector('.ze-progress-dialog')?.textContent ?? null`),
);
chrome.kill();
