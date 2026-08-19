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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface FakeEvent {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  target: null;
  defaultPrevented: boolean;
  preventDefault: () => void;
}

const ev = (key: string, mods: Partial<FakeEvent> = {}): FakeEvent => {
  const e: FakeEvent = {
    key,
    target: null,
    defaultPrevented: false,
    preventDefault() {
      e.defaultPrevented = true;
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
