// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { useEffect, useState } from 'react';

/**
 * Small-touchscreen detection for the desktop gate.
 *
 * KiCad is a desktop application: there is no upstream phone UI to mirror, and
 * the editors lean on a mouse throughout, hover tooltips, right-click context
 * menus, modifier-key drags and single-letter hotkeys. Rather than invent a
 * touch UX with no reference (and fork the file structure that keeps us honest
 * against KiCad's source), we detect the devices that cannot drive the app and
 * show them a way to come back on a real machine.
 *
 * Two queries, ANDed in JS rather than written as one
 * `(pointer: coarse) and (max-width: ...)` string, media-query boolean logic
 * is Level 4 and only lands in Safari 16.4+, while each feature below is
 * universally supported.
 *
 *   - SMALL, rules out desktops, and tablets in landscape (iPad landscape is
 *              1133 to 1194 CSS px, which is genuinely workable).
 *   - COARSE, the *primary* pointer is a finger. A touchscreen laptop still
 *              reports `fine` because its main pointer is the trackpad, so
 *              those are never gated.
 *
 * There was a third condition here, `not (any-pointer: fine)`, meant to let a
 * tablet with a Magic Keyboard or Bluetooth mouse through. It silently disabled
 * the gate on real phones: `any-pointer: fine` is reported by plenty of
 * handsets (Android devices advertising stylus capability, among others), so
 * the whole predicate collapsed to false on exactly the hardware it exists to
 * catch. It is gone, and the regression test below pins that behaviour.
 *
 * Cost of dropping it: a *portrait* tablet with a mouse attached now gets the
 * gate. That is a rare pose, keyboard cases hold a tablet in landscape, which
 * passes on width anyway, and "Continue anyway" is one tap. Worth it to make
 * the common case correct.
 */
const SMALL = '(max-width: 1024px)';
const COARSE = '(pointer: coarse)';

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
export const isSmallTouchDevice = (): boolean => matches(SMALL) && matches(COARSE);

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
    /* storage blocked, the in-memory state below still lets them through */
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
      lists = [SMALL, COARSE].map((q) => window.matchMedia(q));
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
