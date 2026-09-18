// A footprint move on a big board, CPU-profiled in Chrome over CDP: open the
// board (the phase traces come along for free), click a footprint, M, move
// the pointer, click to drop, and profile from the pickup to the frame after
// the drop. Says where the drop's time goes in the designer, which node
// cannot reproduce (the React commit and the panel effects).
//
//   (cd designer && VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= pnpm exec vite build --outDir $S/dist-noauth)
//   node qa/probes/serve_spa.mjs $S/dist-noauth 4174 &
//   node --experimental-websocket qa/probes/pcb_move_profile.mjs \
//       "http://localhost:4174/demo/jetson-agx-thor-baseboard?perf=1" 173.17 93.32 out.cpuprofile
//
// The address is the demo's MANAGER page (a no-auth build, since the dev
// server redirects to /signup); the probe clicks the PCB Editor launcher,
// which is the open the user makes. `/demo/<id>/pcb` straight from a cold
// tab opens an empty untitled board instead (2026-09-18) - a bug of its own.
//
// The two numbers are the board position (mm) of the footprint to grab; the
// probe asks the VIEW (`window.__pcbPerf.panel`, published under ?perf=1)
// where that is on screen. Headless Chrome on the real GPU (ANGLE over
// Vulkan); with swiftshader every frame is ~700 ms and the numbers mean
// nothing.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [url, mmX, mmY, out] = process.argv.slice(2);
const port = 9335;
const chrome = spawn(
  '/usr/bin/google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    // The Intel GPU headless: ANGLE over Vulkan (the GL backends give no
    // WebGL2 context under this Wayland session, and swiftshader's frames
    // are ~700 ms).
    '--use-angle=vulkan',
    '--enable-features=Vulkan',
    '--ignore-gpu-blocklist',
    '--window-size=1800,1100',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${process.env.PROF ?? '/tmp/pcb_move_profile'}`,
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
// Let the GPU process bring Vulkan up before the page asks for a context.
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
    if (/Trace:|View timing|Graphics error|WebGL|Error|error|PERFDBG/.test(text))
      console.log(`  [console] ${text.trim()}`);
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

await send('Page.enable');
await send('Runtime.enable');
await send('Profiler.enable');
// Long tasks from the first script on, for the open's phases.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__ltOpen = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ltOpen.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask' });`,
});

// The trace flags, then the board.
const origin = new URL(url).origin;
await send('Page.navigate', { url: `${origin}/` });
await sleep(1500);
await evalJs(
  `localStorage.setItem('WXTRACE','KICAD_ALLEGRO_PERF'); localStorage.setItem('KICAD_TRACE','KICAD_GAL_PROFILE'); 'ok'`,
);
await send('Page.navigate', { url });
await waitFor('the demo project', `document.body.innerText.includes('.kicad_pcb')`, 120000);
await sleep(1000);
const tNav = performance.now();
await evalJs(
  `(() => { const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'PCB Editor'); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!el; })()`,
);
console.log('open (launcher click):');
const built = await waitForLine('BuildConnectivity', /Post-load BuildConnectivity/, 300000);
const firstFrame = await waitForLine('first frame', /View timing/, 300000, built[0]);
console.log(
  `  navigate -> BuildConnectivity ${((built[0] - tNav) / 1000).toFixed(1)} s, -> first frame ${((firstFrame[0] - tNav) / 1000).toFixed(1)} s (${/view-total: ([^ ]+)/.exec(firstFrame[1])?.[1]})`,
);
const frameMs = (line) => {
  const m = /view-total: ([\d.]+)(ms|s|µs)/.exec(line);
  return m
    ? m[2] === 's'
      ? Number(m[1]) * 1000
      : m[2] === 'µs'
        ? Number(m[1]) / 1000
        : Number(m[1])
    : NaN;
};
const stats = (lines) => {
  const v = lines
    .map(frameMs)
    .filter((x) => !Number.isNaN(x))
    .sort((a, b) => a - b);
  if (v.length === 0) return 'no frames';
  return `${v.length} frames, median ${v[v.length >> 1].toFixed(0)} ms, p90 ${v[Math.floor(v.length * 0.9)].toFixed(0)} ms, max ${v[v.length - 1].toFixed(0)} ms`;
};
await waitFor('the panel', `!!(window.__pcbPerf && window.__pcbPerf.panel)`, 30000);
console.log(
  '  long tasks of the open (>200 ms, s+ms):',
  await evalJs(
    `window.__ltOpen.filter(([, d]) => d > 200).map(([s, d]) => (s / 1000).toFixed(1) + '+' + d).join(' ')`,
  ),
);
console.log(
  '  main thread busy in long tasks during the open:',
  await evalJs(`(window.__ltOpen.reduce((a, [, d]) => a + d, 0) / 1000).toFixed(1) + ' s'`),
);
await sleep(3000);

// Zoom to fit (Home), then the footprint's screen position from the VIEW.
const canvasRect = await evalJs(
  `(() => { const c = [...document.querySelectorAll('canvas')].find(c => c.width > 500 && c.getContext('webgl2')); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`,
);
await evalJs(
  `window.__evs = []; for (const t of ['pointerdown','pointerup','mousedown','mouseup','click','keydown','wheel']) document.addEventListener(t, e => window.__evs.push(t + '@' + e.target.tagName + ':' + (e.button ?? e.key) + ' def=' + e.defaultPrevented), true); 'ok'`,
);
const cx = canvasRect.x + canvasRect.w / 2;
const cy = canvasRect.y + canvasRect.h / 2;
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy });
await send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: 'Home',
  code: 'Home',
  windowsVirtualKeyCode: 36,
});
await send('Input.dispatchKeyEvent', {
  type: 'keyUp',
  key: 'Home',
  code: 'Home',
  windowsVirtualKeyCode: 36,
});
await sleep(2500);
console.log('events after Home:', await evalJs(`window.__evs.join(' ')`));
const toScreen = async () => {
  const pt = await evalJs(
    `(() => { const v = window.__pcbPerf.panel.GetView(); const p = v.ToScreen({ x: ${Number(mmX) * 1e6}, y: ${Number(mmY) * 1e6} }); return { x: p.x, y: p.y }; })()`,
  );
  return { x: canvasRect.x + pt.x, y: canvasRect.y + pt.y };
};
// Wheel in on the footprint until it is a target, the zoom the user makes.
let { x: gx, y: gy } = await toScreen();
const tZoom = performance.now();
for (let i = 0; i < 14; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gx, y: gy });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: gx,
    y: gy,
    deltaX: 0,
    deltaY: -120,
  });
  await sleep(700);
  ({ x: gx, y: gy } = await toScreen());
}
const scale = await evalJs(`window.__pcbPerf.panel.GetView().GetScale()`);
console.log(`footprint at screen (${gx.toFixed(0)}, ${gy.toFixed(0)}), view scale ${scale}`);
console.log(
  `zoom (14 wheel ticks in): ${stats(consoleLines.filter(([t, l]) => t > tZoom && /View timing/.test(l)).map(([, l]) => l))}`,
);

const frames = () => consoleLines.filter(([, s]) => /View timing/.test(s)).length;
// Select it (hover first: the editor tracks the pointer), then profile the move.
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gx, y: gy });
await sleep(300);
await send('Input.dispatchMouseEvent', {
  type: 'mousePressed',
  x: gx,
  y: gy,
  button: 'left',
  clickCount: 1,
});
await send('Input.dispatchMouseEvent', {
  type: 'mouseReleased',
  x: gx,
  y: gy,
  button: 'left',
  clickCount: 1,
});
await sleep(1200);
// Two candidates raise the clarification menu; its digit keys pick an entry.
const menu = await evalJs(
  `(() => { const lines = document.body.innerText.split(String.fromCharCode(10)).map(l => l.trim()); const i = lines.findIndex(l => /^1 \\S/.test(l)); if (i < 0) return null; return lines.slice(i, i + 12).filter(l => /^[1-9] \\S/.test(l)); })()`,
);
if (!menu)
  console.log(
    'no clarification menu; body tail:',
    await evalJs(
      `document.body.innerText.split(String.fromCharCode(10)).filter(l => /Select All|Pad |Footprint /.test(l)).slice(0, 6).join(' | ')`,
    ),
  );
if (menu) {
  console.log('clarification menu:', menu.join(' | '));
  const fp = menu.findIndex((l) => /Footprint/.test(l));
  const digit = String(fp >= 0 ? fp + 1 : 1);
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: digit,
    code: `Digit${digit}`,
    text: digit,
    windowsVirtualKeyCode: 48 + Number(digit),
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: digit,
    code: `Digit${digit}`,
    windowsVirtualKeyCode: 48 + Number(digit),
  });
  await sleep(1200);
}
console.log(
  'after CDP click:',
  await evalJs(
    `(() => { const t = document.body.innerText; const i = t.indexOf('Properties'); return t.slice(i, i + 160).split(String.fromCharCode(10)).join(' | ') + ' ... status: ' + t.slice(-160).split(String.fromCharCode(10)).join(' | '); })()`,
  ),
);
console.log(
  'menus/popups:',
  await evalJs(
    `[...document.querySelectorAll('[role=menu], .ze-menu, .ze-popup, .ze-disambig')].map(e => e.className + ':' + e.innerText.slice(0, 60).split(String.fromCharCode(10)).join('/')).join(' || ')`,
  ),
);
console.log('events seen:', await evalJs(`window.__evs.join(' ')`));
console.log(
  'frames so far:',
  frames(),
  'rAF in 1 s:',
  await evalJs(
    `new Promise(r => { let n = 0; const t = performance.now(); (function f() { n++; if (performance.now() - t < 1000) requestAnimationFrame(f); else r(n); })(); })`,
  ),
);
console.log(
  'element at point:',
  await evalJs(
    `(() => { const el = document.elementFromPoint(${gx}, ${gy}); return el ? el.tagName + '.' + el.className + ' ' + el.width + 'x' + el.height + ' pe=' + getComputedStyle(el).pointerEvents : 'none'; })()`,
  ),
);
const selected = await evalJs(
  `(() => { const t = document.body.innerText; const m = /No objects selected|Footprint [^\\n]*|Pad [^\\n]*/.exec(t); return m ? m[0].slice(0, 80) : '(no selection text found)'; })()`,
);
console.log(`selection: ${selected}`);
if (process.env.SHOT) {
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 60 });
  writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, 'base64'));
  console.log(`screenshot: ${process.env.SHOT} (footprint at ${gx.toFixed(0)}, ${gy.toFixed(0)})`);
}

await evalJs(
  `window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask' }); window.__t0 = performance.now(); 'ok'`,
);
await send('Profiler.setSamplingInterval', { interval: 250 });
await send('Profiler.start');
const tPick = performance.now();
await send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: 'm',
  code: 'KeyM',
  text: 'm',
  windowsVirtualKeyCode: 77,
});
await send('Input.dispatchKeyEvent', {
  type: 'keyUp',
  key: 'm',
  code: 'KeyM',
  windowsVirtualKeyCode: 77,
});
await sleep(1500);
for (let i = 1; i <= 8; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gx + i * 8, y: gy + i * 4 });
  await sleep(120);
}
await sleep(1000);
const nBefore = frames();
const tDrop = performance.now();
await send('Input.dispatchMouseEvent', {
  type: 'mousePressed',
  x: gx + 64,
  y: gy + 32,
  button: 'left',
  clickCount: 1,
});
await send('Input.dispatchMouseEvent', {
  type: 'mouseReleased',
  x: gx + 64,
  y: gy + 32,
  button: 'left',
  clickCount: 1,
});
// The drop is over when a frame lands after it and the main thread answers.
let tSettled = 0;
for (let i = 0; i < 600; i++) {
  await sleep(100);
  if (frames() > nBefore) {
    await evalJs('1');
    tSettled = performance.now();
    break;
  }
}
await sleep(4000);
const { result } = await send('Profiler.stop');
console.log(
  'long tasks since pickup (start+ms):',
  await evalJs(
    `window.__lt.map(([s, d]) => ((s - window.__t0) / 1000).toFixed(2) + 's+' + d).join(' ')`,
  ),
);
writeFileSync(out, JSON.stringify(result.profile));
console.log(
  `pickup at +0, drop at +${((tDrop - tPick) / 1000).toFixed(1)} s, first frame after the drop +${tSettled ? ((tSettled - tDrop) / 1000).toFixed(2) : '?'} s after it`,
);
const after = consoleLines
  .filter(([t, s]) => t > tPick && /View timing/.test(s))
  .map(([t, s]) => `${((t - tPick) / 1000).toFixed(2)}s ${/view-total: ([^ ]+)/.exec(s)?.[1]}`);
console.log(`frames during the gesture: ${after.join('  ')}`);
console.log(`profile: ${out}`);
chrome.kill();
process.exit(0);
