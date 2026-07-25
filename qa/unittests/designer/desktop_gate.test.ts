/**
 * Desktop gate device matrix — which devices get turned away
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
  /** The *primary* pointer — a finger ('coarse') or a mouse/trackpad ('fine'). */
  pointer: 'coarse' | 'fine';
  /** Whether *any* precise pointer is available (an attached mouse/trackpad). */
  anyFine: boolean;
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
  (globalThis as { window?: unknown }).window = {
    matchMedia: (q: string) => ({ matches: answer(q) }),
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('isSmallTouchDevice', () => {
  it('gates a phone in portrait', () => {
    asDevice({ width: 390, pointer: 'coarse', anyFine: false }); // iPhone 15
    expect(isSmallTouchDevice()).toBe(true);
  });

  it('gates a phone in landscape — still far too small', () => {
    asDevice({ width: 932, pointer: 'coarse', anyFine: false }); // iPhone 15 Pro Max
    expect(isSmallTouchDevice()).toBe(true);
  });

  it('gates a tablet in portrait', () => {
    asDevice({ width: 820, pointer: 'coarse', anyFine: false }); // iPad Air
    expect(isSmallTouchDevice()).toBe(true);
  });

  it('lets a tablet through in landscape', () => {
    asDevice({ width: 1180, pointer: 'coarse', anyFine: false }); // iPad Air rotated
    expect(isSmallTouchDevice()).toBe(false);
  });

  it('lets a tablet through when a mouse or trackpad is attached', () => {
    asDevice({ width: 820, pointer: 'coarse', anyFine: true }); // iPad + Magic Keyboard
    expect(isSmallTouchDevice()).toBe(false);
  });

  it('never gates a desktop', () => {
    asDevice({ width: 1920, pointer: 'fine', anyFine: true });
    expect(isSmallTouchDevice()).toBe(false);
  });

  it('never gates a touchscreen laptop — its primary pointer is the trackpad', () => {
    asDevice({ width: 1440, pointer: 'fine', anyFine: true });
    expect(isSmallTouchDevice()).toBe(false);
  });

  it('never gates a narrow desktop window — cramped is not unusable', () => {
    asDevice({ width: 800, pointer: 'fine', anyFine: true });
    expect(isSmallTouchDevice()).toBe(false);
  });

  it('does not gate when matchMedia is unavailable', () => {
    (globalThis as { window?: unknown }).window = {};
    expect(isSmallTouchDevice()).toBe(false);
  });
});
