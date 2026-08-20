// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The interaction that killed every hotkey in the app.
 *
 * `claimBrowserHotkeys` installs a CAPTURE-phase listener that calls
 * `preventDefault()` on every combo the app claims, to stop the browser acting.
 * It deliberately does not `stopPropagation`, because the app still has to
 * dispatch the command. But `useMenuHotkeys` read `defaultPrevented` as
 * "someone else handled this" and stood down — and since `HotkeyListHost` is
 * mounted above the whole app (`main.tsx`) and claims every hotkey there is,
 * that meant no menu accelerator fired anywhere, in any frame.
 *
 * qa runs in node with no DOM, so the listener is captured off a stub window
 * and driven with plain objects — which is enough, because the whole mechanism
 * is `preventDefault` + a mark.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeEvent {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  target: null;
  defaultPrevented: boolean;
  preventDefault: () => void;
  /** `modal_escape` stops the key so an editor does not also cancel its tool. */
  stopPropagation: () => void;
  propagationStopped?: boolean;
}

const ev = (key: string, mods: Partial<FakeEvent> = {}): FakeEvent => {
  const e: FakeEvent = {
    key,
    target: null,
    defaultPrevented: false,
    preventDefault() {
      e.defaultPrevented = true;
    },
    stopPropagation() {
      e.propagationStopped = true;
    },
    ...mods,
  };
  return e;
};

let listener: ((e: unknown) => void) | null = null;

beforeEach(() => {
  listener = null;
  (globalThis as { window?: unknown }).window = {
    addEventListener: (_t: string, fn: (e: unknown) => void) => {
      listener = fn;
    },
    removeEventListener: () => undefined,
  };
});
afterEach(() => {
  (globalThis as { window?: unknown }).window = undefined;
});

describe('browser suppression versus menu dispatch', () => {
  it('marks the events it suppresses, so a dispatcher can tell them apart', async () => {
    const mod = await import('@ziroeda/designer/src/ui/browser_hotkeys.js');
    const { release } = mod.claimBrowserHotkeys(['Ctrl+Alt+Q']);
    const e = ev('q', { ctrlKey: true, altKey: true });
    listener?.(e);
    expect(e.defaultPrevented).toBe(true);
    expect(mod.wasBrowserSuppressed(e)).toBe(true);
    release();
  });

  it('does not mark an event some other handler cancelled', async () => {
    const mod = await import('@ziroeda/designer/src/ui/browser_hotkeys.js');
    const e = ev('q', { ctrlKey: true });
    e.preventDefault();
    expect(mod.wasBrowserSuppressed(e)).toBe(false);
  });

  it('does not mark a combo the app never claimed', async () => {
    const mod = await import('@ziroeda/designer/src/ui/browser_hotkeys.js');
    const { release } = mod.claimBrowserHotkeys(['Ctrl+Alt+Q']);
    const e = ev('j', { ctrlKey: true });
    listener?.(e);
    expect(e.defaultPrevented).toBe(false);
    expect(mod.wasBrowserSuppressed(e)).toBe(false);
    release();
  });
});

/**
 * The SECOND consumer of `defaultPrevented`, missed when the first was fixed.
 *
 * Esc is a claimed combo, so `claimBrowserHotkeys` cancels it in capture phase
 * exactly as it cancels every other accelerator. `modal_escape` read that as
 * "someone already handled this" and stood down, so no dialog in the app closed
 * on Esc — while every OTHER accelerator worked, because `useMenuHotkeys` had
 * already been taught the difference. One consumer fixed, one left.
 */
describe('browser suppression versus Esc closing a dialog', () => {
  it('still closes the top dialog when our own suppressor cancelled the key', async () => {
    // Reset first: `modal_escape` registers its window listener once behind a
    // module-level `listening` flag, so a cached module would never re-register
    // onto the stub window. Both modules are imported from the SAME fresh graph
    // so they share the WeakSet that carries the mark.
    vi.resetModules();
    const browser = await import('@ziroeda/designer/src/ui/browser_hotkeys.js');
    const modal = await import('@ziroeda/designer/src/ui/modal_escape.js');

    let cancelled = 0;
    const pop = modal.pushModalCancel(() => {
      cancelled++;
    });
    const escListener = listener;

    const { release } = browser.claimBrowserHotkeys(['Esc']);
    const claimListener = listener;

    const e = ev('Escape');
    // Capture order, as it runs live: the suppressor cancels first.
    claimListener?.(e);
    expect(e.defaultPrevented, 'the suppressor should cancel a claimed Esc').toBe(true);
    expect(browser.wasBrowserSuppressed(e)).toBe(true);

    escListener?.(e);
    expect(cancelled, 'Esc must still reach the dialog').toBe(1);
    // And it stops there, so an editor underneath does not also cancel its tool.
    expect(e.propagationStopped).toBe(true);

    release();
    pop();
  });

  it('still stands down when a REAL handler cancelled the key first', async () => {
    // The behaviour the guard must not throw away: if something genuinely acted
    // on Esc, the dialog stays open.
    vi.resetModules();
    const modal = await import('@ziroeda/designer/src/ui/modal_escape.js');
    let cancelled = 0;
    const pop = modal.pushModalCancel(() => {
      cancelled++;
    });
    const escListener = listener;

    const e = ev('Escape');
    e.preventDefault(); // not marked — some other handler
    escListener?.(e);
    expect(cancelled).toBe(0);

    pop();
  });
});

/**
 * The generalisation. Two consumers of `defaultPrevented` existed and only one
 * was taught about our own suppression; the other broke silently and stayed
 * broken. Any THIRD consumer would do the same, so the rule is checked in the
 * source rather than left to whoever writes it.
 */
describe('every reader of defaultPrevented knows about our own suppression', () => {
  it('has no bare defaultPrevented check in a keydown path', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const dir = fileURLToPath(new URL('../../../designer/src/ui/', import.meta.url));
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') && !f.endsWith('.tsx')) continue;
      // Comments stripped: `menu_hotkeys.ts` DESCRIBES the rule in prose, which
      // is documentation, not a reader of the flag.
      const src = readFileSync(dir + f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (!src.includes('defaultPrevented')) continue;
      // `browser_hotkeys` is the suppressor itself; it does not read the flag.
      if (f === 'browser_hotkeys.ts') continue;
      if (!src.includes('wasBrowserSuppressed')) offenders.push(f);
    }
    expect(
      offenders,
      `these read defaultPrevented without allowing for our own suppression: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
