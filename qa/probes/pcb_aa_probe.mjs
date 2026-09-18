// The compositor's antialiasing modes in headless Chrome: open a demo board,
// switch the GAL display option to each mode at run time (the
// `updatedGalDisplayOptions` path), repaint with every WebGL call checked,
// and print the first call that raises a GL error plus a screenshot per mode.
//
//   node qa/probes/serve_spa.mjs ~/ziro-perf/dist-noauth 4174 &
//   SHOTS=$HOME/ziro-perf/aa node --experimental-websocket qa/probes/pcb_aa_probe.mjs \
//       "http://localhost:4174/demo/ecc83?perf=1"
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [url] = process.argv.slice(2);
const port = 9336;
const chrome = spawn(
  '/usr/bin/google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--use-angle=vulkan',
    '--enable-features=Vulkan',
    '--ignore-gpu-blocklist',
    '--window-size=1800,1100',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${process.env.PROF ?? '/tmp/pcb_aa_probe'}`,
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
    if (/Graphics error|WebGL|Error|error|GL\b/.test(text))
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
const shot = async (name) => {
  if (!process.env.SHOTS) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${process.env.SHOTS}/${name}.png`, Buffer.from(r.result.data, 'base64'));
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
await sleep(2000);

// Every gl method checked after the call; the first error and its call stack kept.
await evalJs(`(() => {
  const p = window.__pcbPerf.panel; const g = p.GetGAL(); const gl = g.gl;
  window.__glErrs = [];
  const proto = Object.getPrototypeOf(gl);
  for (const name of Object.getOwnPropertyNames(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (typeof d.value !== 'function' || name === 'getError') continue;
    const orig = d.value;
    gl[name] = function (...args) {
      const r = orig.apply(this, args);
      const e = orig === proto.getError ? 0 : proto.getError.call(this);
      if (e && window.__glErrs.length < 5) window.__glErrs.push(name + '(' + args.map(a => (a && typeof a === 'object') ? a.constructor.name : String(a)).join(', ') + ') -> ' + e + String.fromCharCode(10) + new Error().stack.split(String.fromCharCode(10)).slice(2, 8).join(String.fromCharCode(10)));
      return r;
    };
  }
  return 'wrapped';
})()`);

for (const mode of [0, 1, 2, 0]) {
  const r = await evalJs(`(() => {
    const p = window.__pcbPerf.panel; const g = p.GetGAL(); const c = g.m_compositor;
    window.__glErrs.length = 0;
    g.m_options.antialiasing_mode = ${mode}; g.m_options.NotifyChanged();
    p.GetView().MarkDirty(); p.DoRePaint(false);
    p.GetView().MarkDirty(); p.DoRePaint(false);
    const gl = g.gl; const w = gl.canvas.width, h = gl.canvas.height; const px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let s = 0, n = 0; for (let i = 0; i < px.length; i += 4 * 97) { s += px[i] + px[i + 1] + px[i + 2]; n++; }
    // Each attachment's mean luma too, to see which stage goes dark.
    const per = [];
    for (let b = 0; b < c.m_buffers.length; b++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, c.m_buffers[b].fbo);
      const d = c.m_buffers[b].dimensions; const q = new Uint8Array(d.x * d.y * 4);
      gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, d.x, d.y, gl.RGBA, gl.UNSIGNED_BYTE, q);
      let t = 0, m = 0, al = 0; for (let i = 0; i < q.length; i += 4 * 97) { t += q[i] + q[i + 1] + q[i + 2]; al += q[i + 3]; m++; }
      per.push('#' + (b + 1) + ' ' + (t / m / 3).toFixed(1) + '/a' + (al / m).toFixed(0));
    }
    gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.bindFramebuffer(gl.FRAMEBUFFER, c.m_curFbo === 0 ? null : c.m_curFbo);
    const ff = g.ff; const ffState = ff ? ' ff tex ' + ff.m_texture2DEnabled + ' color ' + JSON.stringify(ff.m_color || ff.m_currentColor || null) : '';
    return 'luma ' + (s / n / 3).toFixed(1) + ' [' + per.join(', ') + ']' + ffState + ' aa ' + c.GetAntialiasingMode() + ' buffers ' + JSON.stringify((c.m_buffers || []).map(b => b.dimensions.x + 'x' + b.dimensions.y)) + ' screen ' + JSON.stringify(c.GetScreenSize()) + ' errors: ' + (window.__glErrs.length ? String.fromCharCode(10) + window.__glErrs.join(String.fromCharCode(10) + '---' + String.fromCharCode(10)) : 'none');
  })()`);
  await sleep(500);
  console.log(`mode ${mode}: ${r}`);
  await shot(`aa_${mode}`);
}

// A by-hand supersampling composite: main (#2) -> ssaa (#1), then #2 -> screen.
if (process.env.EXPERIMENT) {
  console.log(
    await evalJs(`(() => {
    const p = window.__pcbPerf.panel; const g = p.GetGAL(); const c = g.m_compositor; const gl = g.gl;
    g.m_options.antialiasing_mode = 2; g.m_options.NotifyChanged();
    p.GetView().MarkDirty(); p.DoRePaint(false);
    const lumaOf = (b) => { gl.bindFramebuffer(gl.FRAMEBUFFER, c.m_buffers[b - 1].fbo); const d = c.m_buffers[b - 1].dimensions; const q = new Uint8Array(d.x * d.y * 4); gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, d.x, d.y, gl.RGBA, gl.UNSIGNED_BYTE, q); let t = 0, m = 0; for (let i = 0; i < q.length; i += 4 * 97) { t += q[i] + q[i + 1] + q[i + 2]; m++; } gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.bindFramebuffer(gl.FRAMEBUFFER, c.m_curFbo === 0 ? null : c.m_curFbo); return (t / m / 3).toFixed(1); };
    const screen = () => { const w = gl.canvas.width, h = gl.canvas.height; const px = new Uint8Array(w * h * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.bindFramebuffer(gl.FRAMEBUFFER, c.m_curFbo === 0 ? null : c.m_curFbo); let s = 0, n = 0; for (let i = 0; i < px.length; i += 4 * 97) { s += px[i] + px[i + 1] + px[i + 2]; n++; } return (s / n / 3).toFixed(1); };
    const out = [];
    window.__glErrs.length = 0;
    c.SetBuffer(2);
    out.push('after SetBuffer(2): viewport ' + JSON.stringify(Array.from(gl.getParameter(gl.VIEWPORT))) + ' db0 ' + gl.getParameter(gl.DRAW_BUFFER0) + ' db1 ' + gl.getParameter(gl.DRAW_BUFFER1));
    c.SetBuffer(1); c.ClearBuffer({ r: 0, g: 0, b: 0, a: 1 });
    out.push('after SetBuffer(1)+clear: viewport ' + JSON.stringify(Array.from(gl.getParameter(gl.VIEWPORT))) + ' db0 ' + gl.getParameter(gl.DRAW_BUFFER0) + ' #1 ' + lumaOf(1) + ' #2 ' + lumaOf(2));
    c.DrawBuffer(2, 1);
    out.push('after DrawBuffer(2,1): #1 ' + lumaOf(1) + ' errs ' + window.__glErrs.length + ' blend ' + gl.getParameter(gl.BLEND) + ' scissor ' + gl.getParameter(gl.SCISSOR_TEST) + ' cull ' + gl.getParameter(gl.CULL_FACE) + ' prog ' + (gl.getParameter(gl.CURRENT_PROGRAM) === g.ff.m_program) + ' tex0 ' + (gl.getParameter(gl.TEXTURE_BINDING_2D) === c.m_buffers[1].textureTarget) + ' unit ' + (gl.getParameter(gl.ACTIVE_TEXTURE) - gl.TEXTURE0) + ' mask ' + JSON.stringify(gl.getParameter(gl.COLOR_WRITEMASK)));
    c.DrawBuffer(2, 0);
    out.push('after DrawBuffer(2,0): screen ' + screen() + ' errs ' + window.__glErrs.length);
    c.DrawBuffer(1, 0);
    out.push('after DrawBuffer(1,0): screen ' + screen() + ' errs ' + window.__glErrs.length);
    return out.join(String.fromCharCode(10)) + String.fromCharCode(10) + window.__glErrs.join(String.fromCharCode(10));
  })()`),
  );
}
chrome.kill();
