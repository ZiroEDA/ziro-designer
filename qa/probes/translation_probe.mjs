// Drive the Project Manager headless through a language change and capture it.
//   PROF=$(mktemp -d) OUT=<dir> node --experimental-websocket qa/probes/translation_probe.mjs http://localhost:5211
// For each language: the launcher, the File menu open, the Preferences menu open, a toolbar
// tooltip, and the New Project template selector - and the list of every text the page shows,
// written to <OUT>/<lang>.json so the share that changed against English can be counted.
// The first load sends `Accept-Language: th` with the setting at "Default": that is the
// first-visit detection, and its screenshot is th_detected_*.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const base = process.argv[2] ?? 'http://localhost:5211';
const out = process.env.OUT ?? '.';
mkdirSync(out, { recursive: true });
const port = 9377;
const chrome = spawn(
  '/usr/bin/google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--window-size=1400,900',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${process.env.PROF}`,
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
await sleep(2000);
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) pending.get(m.id)(m);
  else if (m.method === 'Runtime.exceptionThrown')
    logs.push(
      'EXC ' +
        (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(
          0,
          600,
        ),
    );
  else if (m.method === 'Network.responseReceived' && /translation\//.test(m.params.response.url))
    logs.push(`NET ${m.params.response.status} ${m.params.response.url.split('/').pop()}`);
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails)
    throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed');
  return r.result?.result?.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64'));
};
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1400,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});

/**
 * Every text the page shows, split by frame: `pm` is the Project Manager (and whatever is drawn
 * outside any frame - dialogs, menus), `other` the editor frames warmed behind it. A `title` is
 * reported as the tooltip layer would draw it, since that is where one is translated.
 */
const TEXTS = `(async () => {
  const { translateTooltip } = await import('/@fs${process.env.REPO ?? '/home/akshay/wt-i18n'}/common/tool/tool_action_tooltip.ts');
  const out = { pm: [], other: [] };
  const scope = (el) => { const app = el.closest('.ze-app'); return app && !app.querySelector('.ze-home-body') ? out.other : out.pm; };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest('script,style')) continue;
    const t = n.textContent.replace(/\\s+/g, ' ').trim();
    if (t) scope(el).push(t);
  }
  for (const el of document.querySelectorAll('[data-tip],[title],[aria-label]')) {
    for (const a of ['data-tip', 'title', 'aria-label']) { const v = el.getAttribute(a); if (v) scope(el).push(a + '=' + (a === 'aria-label' ? v : translateTooltip(v))); }
  }
  return out;
})()`;
const click = (sel, text) =>
  evalJs(
    `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => ${text === undefined ? 'true' : `e.textContent.trim() === ${JSON.stringify(text)}`}); if (!el) return false; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); return true; })()`,
  );
const hover = async (sel) => {
  const box = await evalJs(
    `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  if (!box) return false;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x - 3, y: box.y - 3 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  return true;
};
const closeMenus = () =>
  evalJs(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })), true`);
/** The n-th menu of the bar, by position: its label changes with the language. */
const openMenu = (n) =>
  evalJs(
    `(() => { const m = document.querySelectorAll('.ze-menubar .ze-menu')[${n}]; if (!m) return false; m.click(); return true; })()`,
  );

async function capture(tag) {
  const texts = { home: await evalJs(TEXTS) };
  await shot(`${tag}_1_home`);
  await openMenu(0);
  await sleep(250);
  texts.file = await evalJs(TEXTS);
  await shot(`${tag}_2_file_menu`);
  await closeMenus();
  await openMenu(3);
  await sleep(250);
  texts.tools = await evalJs(TEXTS);
  await closeMenus();
  await openMenu(4);
  await sleep(250);
  texts.prefs = await evalJs(TEXTS);
  await shot(`${tag}_3_prefs_menu`);
  // Set Language is the last row; the pointer on it opens the list.
  if (await hover('.ze-menubar .ze-dropdown > .ze-mitem.has-sub:last-child')) {
    await sleep(500);
    await shot(`${tag}_3b_set_language`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 700 });
  }
  await closeMenus();
  await openMenu(5);
  await sleep(250);
  texts.help = await evalJs(TEXTS);
  await closeMenus();
  if (await hover('.ze-mgrbar button')) {
    await sleep(900);
    texts.tooltip = await evalJs(
      `[...document.querySelectorAll('.ze-tooltip')].map((e) => e.textContent)`,
    );
    await shot(`${tag}_4_toolbar_tooltip`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 500 });
  }
  // File > New Project... opens the template selector.
  await openMenu(0);
  await sleep(200);
  await evalJs(
    `(() => { const row = document.querySelector('.ze-dropdown .ze-mitem'); row?.click(); return !!row; })()`,
  );
  await sleep(1200);
  texts.newProject = await evalJs(TEXTS);
  await shot(`${tag}_5_template_selector`);
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await sleep(300);
  writeFileSync(`${out}/${tag}.json`, JSON.stringify(texts, null, 1));
  return texts;
}

/** Preferences > Set Language > the row with this label. */
async function pickLanguage(label) {
  await openMenu(4);
  await sleep(200);
  const ok = await evalJs(`(async () => {
    const sub = [...document.querySelectorAll('.ze-dropdown > .ze-mitem.has-sub')].at(-1);
    if (!sub) return 'no submenu row';
    sub.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    const row = [...sub.querySelectorAll('.ze-mitem')].find((r) => r.querySelector('.lbl')?.textContent === ${JSON.stringify(label)});
    if (!row) return 'no row';
    row.click();
    return 'ok';
  })()`);
  await sleep(1500);
  await closeMenus();
  return ok;
}

// 1. First visit, browser set to Thai, nothing stored.
await send('Network.setUserAgentOverride', {
  userAgent: await evalJs('navigator.userAgent'),
  acceptLanguage: 'th-TH,th',
});
await send('Page.navigate', { url: base + (process.env.ROUTE ?? '/') });
await sleep(Number(process.env.LOAD_MS ?? 9000));
console.log(
  'navigator.languages',
  await evalJs('JSON.stringify(navigator.languages)'),
  'html lang',
  await evalJs('document.documentElement.lang'),
);
console.log(
  'stored system.language',
  await evalJs(
    `(() => { try { return JSON.parse(localStorage.getItem('ziroeda.common') ?? '{}').system?.language ?? '(nothing stored)'; } catch (e) { return String(e); } })()`,
  ),
);
await capture('th_detected');

for (const [tag, label] of [
  ['en', 'English'],
  ['de', 'Deutsch'],
  ['th', 'ภาษาไทย'],
  ['zh_CN', '简体中文'],
]) {
  console.log(
    tag,
    'pick:',
    await pickLanguage(label),
    'html lang',
    await evalJs('document.documentElement.lang'),
  );
  await capture(tag);
}
console.log(
  'stored system.language',
  await evalJs(
    `(() => { try { return JSON.parse(localStorage.getItem('ziroeda.common') ?? '{}').system?.language ?? '(nothing stored)'; } catch (e) { return String(e); } })()`,
  ),
);
// The choice is remembered: reload, still Chinese although the browser says Thai.
await send('Page.reload');
await sleep(Number(process.env.LOAD_MS ?? 9000));
console.log('after reload: html lang', await evalJs('document.documentElement.lang'));
await shot('zh_CN_6_after_reload');
console.log(logs.join('\n'));
ws.close();
chrome.kill();
