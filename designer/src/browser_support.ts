// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * What the app needs from a browser, and what to say when it is missing.
 *
 * Without this an unsupported browser gets a **white screen** — the module
 * graph loads, something calls `structuredClone`, a `TypeError` comes out of a
 * file the user has never heard of, and nothing on the page changes. They
 * cannot tell whether the app is broken or their browser is, and the crash
 * screen cannot help because the failure is often before React mounts.
 *
 * The list is deliberately short. It names the features that decide whether the
 * app can run at all, not every modern API it happens to use, because a probe
 * that is stricter than the app turns working browsers away.
 *
 * The floor these imply is roughly Chrome 98 / Edge 98 / Firefox 94 /
 * Safari 15.4 — spring 2022. `navigator.locks` is on the list because project
 * saves serialise through it; the code falls back without it, but the fallback
 * does not protect a second tab, and a user who cannot be protected from
 * losing work is better told than surprised.
 */

export interface Missing {
  /** What the user's browser lacks, in words they can act on. */
  feature: string;
}

type Probe = { feature: string; ok: () => boolean };

const PROBES: Probe[] = [
  { feature: 'structured cloning', ok: () => typeof structuredClone === 'function' },
  {
    feature: 'modern array methods',
    ok: () => typeof [].at === 'function' && typeof [].flatMap === 'function',
  },
  { feature: 'element size observation', ok: () => typeof ResizeObserver === 'function' },
  {
    feature: 'local storage of projects',
    ok: () => typeof indexedDB === 'object' && indexedDB !== null,
  },
  {
    feature: 'cross-tab locking',
    ok: () => typeof navigator === 'object' && 'locks' in navigator,
  },
];

/** Everything missing, in probe order. Empty means the browser will do. */
export function missingFeatures(probes: Probe[] = PROBES): Missing[] {
  const out: Missing[] = [];
  for (const p of probes) {
    let ok = false;
    try {
      ok = p.ok();
    } catch {
      ok = false; // a probe that throws is a browser that cannot do the thing
    }
    if (!ok) out.push({ feature: p.feature });
  }
  return out;
}

/**
 * The message shown instead of the app. Names the missing pieces and what to
 * do about it — an unexplained failure is the thing being fixed, so a generic
 * "unsupported browser" would only be a prettier white screen.
 */
export function unsupportedMessage(missing: readonly Missing[]): string {
  const list = missing.map((m) => m.feature).join(', ');
  return (
    `This browser is missing ${list}, which Ziro Designer needs to run.\n\n` +
    'Please use a current version of Chrome, Edge, Firefox or Safari. ' +
    'Your projects are stored in this browser, so opening the app in a ' +
    'supported one on the same machine will not carry them across — export ' +
    'anything you need from the browser you saved it in.'
  );
}
