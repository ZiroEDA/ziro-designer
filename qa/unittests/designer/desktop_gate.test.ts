// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Desktop gate device matrix, which devices get turned away
 * (designer/src/mobile/useDesktopGate.ts).
 *
 * The gate is deliberately narrow: it should catch phones (which cannot drive
 * KiCad's mouse-first editors at all) while never blocking a desktop, a tablet
 * in landscape, or a tablet with a pointing device attached.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { isSmallTouchDevice } from '@ziroeda/designer/src/mobile/useDesktopGate.js';

/** How a device answers the three media features the gate consults. */
interface Device {
  /** Viewport width in CSS px. */
  width: number;
  /** The *primary* pointer, a finger ('coarse') or a mouse/trackpad ('fine'). */
  pointer: 'coarse' | 'fine';
  /** Whether *any* precise pointer is available (an attached mouse/trackpad). */
  anyFine: boolean;
  /** The device's screen, CSS px, `[width, height]`; a desktop monitor when omitted. */
  screen?: [number, number];
}

/** Install a `window.matchMedia` that answers as `d` would. */
function asDevice(d: Device): void {
  const answer = (q: string): boolean => {
    const width = /max-width:\s*(\d+)px/.exec(q);
    if (width) return d.width <= Number(width[1]);
    if (q.includes('any-pointer: fine')) return d.anyFine;
    if (q.includes('pointer: coarse')) return d.pointer === 'coarse';
    throw new Error(`unexpected media query: ${q}`);
  };
  const [sw, sh] = d.screen ?? [1920, 1080];
  (globalThis as { window?: unknown }).window = {
    matchMedia: (q: string) => ({ matches: answer(q) }),
    screen: { width: sw, height: sh },
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('isSmallTouchDevice', () => {
  it('gates a phone in portrait', () => {
    asDevice({ width: 390, pointer: 'coarse', anyFine: false, screen: [390, 844] }); // iPhone 15
    expect(isSmallTouchDevice()).toBe(true);
  });

  it('gates a phone that also reports a fine pointer', () => {
    // Regression: the gate shipped with a `not (any-pointer: fine)` condition,
    // on the assumption that only a tablet-with-mouse reports `fine`. Plenty of
    // handsets report it (stylus-capable Android devices among them), so the
    // predicate collapsed to false and the app opened normally on phones. The
    // fixtures had encoded the same wrong assumption, so the suite stayed green
    // while the feature did nothing.
    asDevice({ width: 390, pointer: 'coarse', anyFine: true, screen: [390, 844] });
    expect(isSmallTouchDevice()).toBe(true);
  });

  it('gates a phone in landscape, still far too small', () => {
    asDevice({ width: 932, pointer: 'coarse', anyFine: true, screen: [430, 932] }); // iPhone 15 Pro Max
    expect(isSmallTouchDevice()).toBe(true);
  });

  it('gates a tablet in portrait', () => {
    asDevice({ width: 820, pointer: 'coarse', anyFine: false, screen: [820, 1180] }); // iPad Air
    expect(isSmallTouchDevice()).toBe(true);
  });

  it('lets a tablet through in landscape', () => {
    asDevice({ width: 1180, pointer: 'coarse', anyFine: false, screen: [1180, 820] }); // iPad Air rotated
    expect(isSmallTouchDevice()).toBe(false);
  });

  it('gates a portrait tablet even with a mouse attached, the accepted cost', () => {
    // Dropping the any-pointer condition costs this case. Rare in practice
    // (keyboard cases hold a tablet in landscape, which passes on width).
    asDevice({ width: 820, pointer: 'coarse', anyFine: true, screen: [820, 1180] }); // iPad + Magic Keyboard
    expect(isSmallTouchDevice()).toBe(true);
  });

  it('gates any phone by its SCREEN, whatever its pointer and window claim', () => {
    // A phone browser in "desktop site" mode can report a 980 px viewport and a
    // fine pointer; the screen is still a phone's, so the app does not run.
    asDevice({ width: 980, pointer: 'fine', anyFine: true, screen: [412, 915] });
    expect(isSmallTouchDevice()).toBe(true);
  });

  it('does not gate a narrow window on a desktop screen', () => {
    asDevice({ width: 600, pointer: 'fine', anyFine: true, screen: [1920, 1080] });
    expect(isSmallTouchDevice()).toBe(false);
  });

  it('never gates a desktop', () => {
    asDevice({ width: 1920, pointer: 'fine', anyFine: true });
    expect(isSmallTouchDevice()).toBe(false);
  });

  it('never gates a touchscreen laptop, its primary pointer is the trackpad', () => {
    asDevice({ width: 1440, pointer: 'fine', anyFine: true });
    expect(isSmallTouchDevice()).toBe(false);
  });

  it('never gates a narrow desktop window, cramped is not unusable', () => {
    asDevice({ width: 800, pointer: 'fine', anyFine: true });
    expect(isSmallTouchDevice()).toBe(false);
  });

  it('does not gate when matchMedia is unavailable', () => {
    (globalThis as { window?: unknown }).window = {};
    expect(isSmallTouchDevice()).toBe(false);
  });
});
