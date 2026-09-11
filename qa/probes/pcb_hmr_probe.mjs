// Does a Vite HMR update empty the PCB editor's GL board layer?
//
// Reported 2026-09-11 as "the board simply vanishes, many times, and Refresh
// does not bring it back": pads, tracks and pours gone, net names and the
// ratsnest still there. Any save in the editor's import graph (another
// session working in the same checkout the dev server serves) is an HMR
// update; React re-runs every effect of PcbEditor in order, the GL mount
// effect's cleanup drops the device, the Footprints Front/Back effect
// rebuilds the scene while `glOkRef` is down (16 797 `Path2D`s), and the mount
// effect then brings the GPU back to draw a scene it cannot read.
//
// Needs a dev server whose demos resolve; the catalogue host stalls from here,
// so serve them locally (see memory_infra.mjs) and run vite with
//   VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= VITE_DEMOS_URL=http://localhost:4177/demos
//
//   PROF=$S/prof node --experimental-websocket qa/probes/pcb_hmr_probe.mjs \
//       http://localhost:5199/demo/video designer/src/editors/pcb/toggles.ts
//
// Measured: before the fix the GL layer went 139 736 painted pixels -> 2 055
// (the text) on the first touch and stayed there; after it, 139 736 through
// three updates. The canvas is read back through a forced
// `preserveDrawingBuffer`, without which WebGL reads 0 after compositing.
import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const [url, touchFile] = process.argv.slice(2);
const port = 9339;
const chrome = spawn(
  '/usr/bin/google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--use-angle=gl',
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
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) pending.get(m.id)(m);
  else if (m.method === 'Network.loadingFailed')
    logs.push('FAIL ' + m.params.errorText + ' ' + (m.params.blockedReason ?? ''));
  else if (m.method === 'Network.responseReceived' && m.params.response.status >= 400)
    logs.push('HTTP ' + m.params.response.status + ' ' + m.params.response.url.slice(0, 100));
  else if (m.method === 'Network.requestWillBeSent' && /demos/.test(m.params.request.url))
    logs.push('REQ ' + m.params.request.url.slice(0, 100));
  else if (m.method === 'Runtime.consoleAPICalled')
    logs.push(
      m.params.type +
        ': ' +
        m.params.args
          .map((a) => a.value ?? a.description ?? '')
          .join(' ')
          .slice(0, 200),
    );
  else if (m.method === 'Runtime.exceptionThrown')
    logs.push(
      'EXC: ' +
        (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(
          0,
          300,
        ),
    );
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evalJs = async (e) =>
  (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }))
    .result?.result?.value;
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => { window.__p2d = 0; const P = window.Path2D; window.Path2D = new Proxy(P, { construct(t, a, nt) { window.__p2d++; if (window.__p2dtrace && window.__p2dstacks.length < 3000) window.__p2dstacks.push(new Error().stack.split('\\n').slice(2, 14).map(l => l.trim().replace(/^at /, '').replace(/http:\\/\\/localhost:5199\\/src\\//g, '')).join(' <- ')); return Reflect.construct(t, a, nt); } }); window.__stacks = []; const og = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, a) { if (t === 'webgl2' || t === 'webgl') a = { ...(a ?? {}), preserveDrawingBuffer: true }; if (t === 'webgl2') window.__stacks.push(new Error().stack.split('\\n').slice(1, 6).join(' <- ')); return og.call(this, t, a); }; })();`,
});
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Page.navigate', { url });
for (let i = 0; i < 300; i++) {
  await sleep(200);
  if (
    await evalJs(
      `document.title.includes('[Read Only]') && !document.querySelector('.ze-progress-dialog')`,
    )
  )
    break;
}
await evalJs(
  `[...document.querySelectorAll('button.ze-launcher')].find(e => e.textContent.trim().startsWith('PCB Editor'))?.click()`,
);
for (let i = 0; i < 300; i++) {
  await sleep(200);
  if (await evalJs(`!document.querySelector('.ze-progress-dialog')`)) break;
}
await sleep(3000);
// Count painted pixels on every canvas in the visible PCB frame.
const probe = `(() => { const out = []; for (const c of document.querySelectorAll('canvas')) { if (!c.checkVisibility()) continue; const gl = c.getContext('webgl2') ; let n = 0; if (gl) { const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight; const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); for (let i = 3; i < px.length; i += 4) if (px[i]) n++; out.push('gl ' + w + 'x' + h + ' painted=' + n); } else { const ctx = c.getContext('2d'); if (!ctx) continue; const d = ctx.getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; out.push('2d ' + c.width + 'x' + c.height + ' painted=' + n + ' ' + (c.className || '')); } } return out.join(' | '); })()`;
console.log(
  'title',
  await evalJs('document.title'),
  'canvases',
  await evalJs("document.querySelectorAll('canvas').length"),
  'text',
  (await evalJs('document.body.innerText')).slice(0, 200).replace(/\n/g, ' / '),
);
console.log(
  'before:',
  await evalJs(probe),
  'Path2D built:',
  await evalJs('window.__p2d'),
  'webgl2 contexts:',
  await evalJs('window.__stacks.length'),
);
await evalJs('window.__p2d = 0; window.__p2dtrace = true; window.__p2dstacks = [];');
console.log('  logs:', logs.filter((l) => !/REQ|DevTools|debug:/.test(l)).join(' || '));
logs.length = 0;
for (let round = 1; round <= 3; round++) {
  execSync(`touch ${touchFile}`);
  await sleep(4000);
  // A pan keeps the frame drawing after the update, as a user's mouse would.
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 800, y: 600 });
  await sleep(500);
  console.log(
    `after touch #${round}:`,
    await evalJs(probe),
    'Path2D built:',
    await evalJs('window.__p2d'),
    'webgl2 contexts:',
    await evalJs('window.__stacks.length'),
  );
  console.log(
    await evalJs(
      `(() => { const h = new Map(); for (const s of window.__p2dstacks) { const k = s.split(' <- ').filter(f => !/renderBoard|gl_path|<anonymous>/.test(f)).slice(0, 5).join(' <- '); h.set(k, (h.get(k) ?? 0) + 1); } return [...h.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => n + 'x  ' + k).join('\\n'); })()`,
    ),
  );
  console.log('  logs:', logs.filter((l) => !/REQ|DevTools|debug:/.test(l)).join(' || '));
  logs.length = 0;
}
console.log(
  'console:\n' +
    logs
      .filter((l) => !/vite|hmr/i.test(l) || /error|warn/i.test(l))
      .slice(-25)
      .join('\n'),
);
chrome.kill();
