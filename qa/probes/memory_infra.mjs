// Which allocator holds a renderer's memory while an editor opens, from
// Chrome's own memory-infra dumps over CDP: private footprint, the main and
// worker V8 heaps, PartitionAlloc, malloc, gpu, canvas, cc, blink GC.
//
// This is what attributed the "Aw, Snap! Out of Memory" of 2026-09-11 (see
// memory_timeline.mjs, which only showed the RSS jump): 922 MB of the 1.5 GB
// peak was the four symbol-preload workers' heaps, each holding a full
// s-expression tree of a 10-15 MB library.
//
//   PROF=$S/prof STEP=500 SPAN=12000 node --experimental-websocket \
//       qa/probes/memory_infra.mjs http://localhost:4177/demo/video "Schematic Editor"
//
// Wants a build whose catalogue is served from localhost: this machine's
// link to the bucket stalls for minutes, and a preload that trickles in
// over the network never reaches the peak that a resident bundle does. The
// first row is the manager; every launcher named after the URL is clicked
// from a fresh manager and sampled every STEP ms for SPAN ms.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const [url, launcher] = process.argv.slice(2);
const port = 9338;
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
const chunks = [];
let done;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) pending.get(m.id)(m);
  else if (m.method === 'Tracing.dataCollected') chunks.push(...m.params.value);
  else if (m.method === 'Tracing.tracingComplete') done?.();
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
await send('Page.navigate', { url });
for (let i = 0; i < 600; i++) {
  await sleep(200);
  if (
    await evalJs(
      `document.title.includes('[Read Only]') && !document.querySelector('.ze-progress-dialog')`,
    )
  )
    break;
}
await sleep(6000);
await send('Tracing.start', {
  categories: 'disabled-by-default-memory-infra',
  transferMode: 'ReportEvents',
  options: 'record-until-full',
});
const dumps = {};
const dump = async (label) => {
  const r = await send('Tracing.requestMemoryDump', { levelOfDetail: 'detailed' });
  dumps[r.result.guid] = label;
};
await dump('manager');
const home = async () => {
  await evalJs(
    `history.pushState({}, '', location.pathname.replace(//(pcb|schematic|symbols|footprints)$/, '')); dispatchEvent(new PopStateEvent('popstate'))`,
  );
  await sleep(1500);
};
for (const l of process.argv.slice(3)) {
  const step = Number(process.env.STEP ?? 500),
    span = Number(process.env.SPAN ?? 20000);
  await evalJs(
    `[...document.querySelectorAll('button.ze-launcher')].find(e => e.textContent.trim().startsWith(${JSON.stringify(l)}))?.click()`,
  );
  for (let t = 0; t <= span; t += step) {
    await dump(l + ' +' + (t / 1000).toFixed(1) + 's');
    await sleep(step);
  }
  console.log('url now', await evalJs('location.href'));
  await home();
}
const fin = new Promise((r) => (done = r));
await send('Tracing.end');
await fin;
const ev = chunks.filter((e) => e.ph === 'v');
const pidNames = {};
for (const e of chunks) if (e.name === 'process_name') pidNames[e.pid] = e.args?.name;
const labels = Object.values(dumps);
const ids = [
  ...new Set(
    ev
      .filter((e) => /Renderer/.test(pidNames[e.pid] ?? ''))
      .sort((a, b) => a.ts - b.ts)
      .map((e) => e.id),
  ),
];
const order = ids;
const lab = (id) => labels[ids.indexOf(id)] ?? id;
const rows = new Map();
for (const e of ev) {
  if (!/Renderer/.test(pidNames[e.pid] ?? '')) continue;
  const d = e.args.dumps;
  const r = rows.get(e.id) ?? {};
  rows.set(e.id, r);
  if (d.process_totals)
    r.pmf = parseInt(d.process_totals.private_footprint_bytes ?? '0', 16) / 1048576;
  const g = (k) => {
    const v = d.allocators?.[k];
    const a = v?.attrs?.effective_size ?? v?.attrs?.size;
    return a ? parseInt(a.value, 16) / 1048576 : 0;
  };
  if (d.allocators)
    Object.assign(r, {
      main: g('v8/main'),
      workers: g('v8/workers'),
      nw: Object.keys(d.allocators).filter((k) => /^v8\/workers\/heap\/old_space\/isolate_/.test(k))
        .length,
      pa: g('partition_alloc'),
      malloc: g('malloc'),
      gpu: g('gpu'),
      canvas: g('canvas'),
      cc: g('cc'),
      blink: g('blink_gc'),
      wasm: g('v8/main/heap/code_space'),
    });
}
console.log(
  'label'.padEnd(26),
  'footprint  v8/main v8/workers(n)  partition  malloc  gpu  canvas  cc  blink',
);
for (const id of order) {
  const r = rows.get(id);
  if (!r) continue;
  const f = (x) => String(Math.round(x ?? 0)).padStart(6);
  console.log(
    String(lab(id)).padEnd(26),
    f(r.pmf),
    f(r.main),
    f(r.workers) + '(' + (r.nw ?? 0) + ')',
    f(r.pa),
    f(r.malloc),
    f(r.gpu),
    f(r.canvas),
    f(r.cc),
    f(r.blink),
  );
}
chrome.kill();
