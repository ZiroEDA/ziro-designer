import { useEffect, useState } from 'react';

/**
 * Small-touchscreen detection for the desktop gate.
 *
 * KiCad is a desktop application: there is no upstream phone UI to mirror, and
 * the editors lean on a mouse throughout — hover tooltips, right-click context
 * menus, modifier-key drags and single-letter hotkeys. Rather than invent a
 * touch UX with no reference (and fork the file structure that keeps us honest
 * against KiCad's source), we detect the devices that cannot drive the app and
 * show them a way to come back on a real machine.
 *
 * The predicate is deliberately three separate queries ANDed in JS rather than
 * one `(pointer: coarse) and (max-width: ...) and (not (any-pointer: fine))`
 * media string — media-query boolean `not` is Level 4 and only lands in Safari
 * 16.4+, while each individual feature below is universally supported.
 *
 *   - SMALL   — rules out desktops, and tablets in landscape (iPad landscape is
 *               1133–1194 CSS px, which is genuinely workable).
 *   - COARSE  — the *primary* pointer is a finger. A touchscreen laptop still
 *               reports `fine` because its main pointer is the trackpad, so
 *               those are never gated.
 *   - NO_FINE — nothing precise is attached at all. An iPad with a Magic
 *               Keyboard or a Bluetooth mouse reports `any-pointer: fine`, and
 *               that user can drive the editors, so we let them through.
 */
const SMALL = '(max-width: 1024px)';
const COARSE = '(pointer: coarse)';
const ANY_FINE = '(any-pointer: fine)';

/** Set once by "Continue anyway", so the choice survives a reload. */
const OVERRIDE_KEY = 'ziro.desktopGate.override';

const matches = (q: string): boolean => {
  try {
    return window.matchMedia(q).matches;
  } catch {
    return false; // no matchMedia (very old / non-browser): never gate
  }
};

/** True when this device is too small and too touch-only to run the editors. */
export const isSmallTouchDevice = (): boolean =>
  matches(SMALL) && matches(COARSE) && !matches(ANY_FINE);

const overridden = (): boolean => {
  try {
    return localStorage.getItem(OVERRIDE_KEY) === '1';
  } catch {
    return false; // storage blocked (private mode / third-party cookie rules)
  }
};

/** Remember that the user chose to proceed on a gated device anyway. */
export const setDesktopGateOverride = (): void => {
  try {
    localStorage.setItem(OVERRIDE_KEY, '1');
  } catch {
    /* storage blocked — the in-memory state below still lets them through */
  }
};

/**
 * Whether to show the gate instead of the app. Re-evaluates on resize and
 * orientation change (both surface as a `change` on the media queries), so
 * turning a tablet to landscape drops the gate live rather than on reload.
 */
export function useDesktopGate(): { gated: boolean; dismiss: () => void } {
  const [small, setSmall] = useState(isSmallTouchDevice);
  const [bypass, setBypass] = useState(overridden);

  useEffect(() => {
    let lists: MediaQueryList[];
    try {
      lists = [SMALL, COARSE, ANY_FINE].map((q) => window.matchMedia(q));
    } catch {
      return;
    }
    const onChange = () => setSmall(isSmallTouchDevice());
    // Safari < 14 has no addEventListener on MediaQueryList, only addListener.
    for (const l of lists) {
      if (l.addEventListener) l.addEventListener('change', onChange);
      else l.addListener?.(onChange);
    }
    onChange(); // catch a rotation that happened between first paint and effect
    return () => {
      for (const l of lists) {
        if (l.removeEventListener) l.removeEventListener('change', onChange);
        else l.removeListener?.(onChange);
      }
    };
  }, []);

  const dismiss = () => {
    setDesktopGateOverride();
    setBypass(true);
  };

  return { gated: small && !bypass, dismiss };
}
