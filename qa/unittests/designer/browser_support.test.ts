// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The browser capability probe.
 *
 * What it replaces: an unsupported browser got a white screen. The module graph
 * loaded, something called `structuredClone`, a TypeError came out of a file
 * the user had never heard of, and nothing on the page changed — the crash
 * screen could not help because the failure is usually before React mounts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { missingFeatures, unsupportedMessage } from '@ziroeda/designer/src/browser_support.js';

describe('the probe', () => {
  // Node >= 21 defines `navigator` as a getter-only own property of globalThis,
  // so plain assignment throws. stubGlobal goes through defineProperty and
  // unstubAllGlobals puts the original descriptor back.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes on a browser that has the floor', () => {
    // The real probe list, against an environment shaped like the oldest
    // browser we mean to support. A failure here means the probe is stricter
    // than the app — which turns working browsers away, the opposite of the
    // bug. (Node has none of these globals, so they are supplied.)
    vi.stubGlobal('ResizeObserver', class {});
    vi.stubGlobal('indexedDB', {});
    vi.stubGlobal('navigator', { locks: { request: () => Promise.resolve() } });
    // WebGL2 is the one probe that needs a canvas rather than a global.
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: () => ({ getExtension: () => null }) }),
    });
    expect(missingFeatures()).toEqual([]);
  });

  it('reports a browser missing each one', () => {
    // The inverse: with none of them present, every probe must notice. This is
    // what a 2021 Safari looks like to the app.
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    const names = missingFeatures().map((m) => m.feature);
    expect(names).toContain('local storage of projects');
    expect(names).toContain('cross-tab locking');
    expect(names).toContain('hardware-accelerated graphics (WebGL2)');
  });

  it('turns away a browser with no WebGL2 rather than drawing it something else', () => {
    // There is no second renderer any more. `getContext('webgl2')` answering
    // null is the whole of the question - a browser that lacks it and one that
    // has it switched off are the same case here.
    vi.stubGlobal('ResizeObserver', class {});
    vi.stubGlobal('indexedDB', {});
    vi.stubGlobal('navigator', { locks: { request: () => Promise.resolve() } });
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });

    expect(missingFeatures().map((m) => m.feature)).toEqual([
      'hardware-accelerated graphics (WebGL2)',
    ]);
  });

  it('releases the context it probed with', () => {
    // A probe that leaves a live WebGL2 context behind costs a real one: a
    // browser gives out a small number of them.
    let lost = 0;
    vi.stubGlobal('ResizeObserver', class {});
    vi.stubGlobal('indexedDB', {});
    vi.stubGlobal('navigator', { locks: { request: () => Promise.resolve() } });
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => ({
          getExtension: (n: string) =>
            n === 'WEBGL_lose_context'
              ? {
                  loseContext: () => {
                    lost += 1;
                  },
                }
              : null,
        }),
      }),
    });

    expect(missingFeatures()).toEqual([]);
    expect(lost).toBe(1);
  });

  it('reports every missing feature, not just the first', () => {
    const missing = missingFeatures([
      { feature: 'one', ok: () => false },
      { feature: 'two', ok: () => true },
      { feature: 'three', ok: () => false },
    ]);
    expect(missing.map((m) => m.feature)).toEqual(['one', 'three']);
  });

  it('treats a probe that throws as a missing feature', () => {
    // An old engine can throw rather than return false — reading a property
    // off an undefined global, for instance. Either way it cannot do the thing.
    const missing = missingFeatures([
      {
        feature: 'boom',
        ok: () => {
          throw new TypeError('undefined is not an object');
        },
      },
    ]);
    expect(missing.map((m) => m.feature)).toEqual(['boom']);
  });
});

describe('the message', () => {
  it('names what is missing rather than saying "unsupported"', () => {
    // A generic message is only a prettier white screen: the user still cannot
    // tell what to do.
    const text = unsupportedMessage([{ feature: 'structured cloning' }]);
    expect(text).toContain('structured cloning');
  });

  it('lists several missing features together', () => {
    const text = unsupportedMessage([{ feature: 'a' }, { feature: 'b' }]);
    expect(text).toContain('a, b');
  });

  it('warns that projects do not follow you to another browser', () => {
    // Projects live in this browser's IndexedDB. Telling someone to switch
    // browsers without saying that is telling them to leave their work behind.
    const text = unsupportedMessage([{ feature: 'x' }]);
    expect(text.toLowerCase()).toContain('stored in this browser');
  });
});
