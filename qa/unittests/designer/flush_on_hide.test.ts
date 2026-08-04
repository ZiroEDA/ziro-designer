// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Flushing pending autosave writes when the page stops being visible.
 *
 * The bug this closes: autosave is debounced 1.2 s, so an edit followed within
 * that window by a tab close, a reload or a swipe to another app never reached
 * storage — silently, with the work gone.
 */
import { describe, it, expect } from 'vitest';
import { installFlushOnHide } from '@ziroeda/designer/src/home/flush_on_hide.js';

/** A stand-in for `document` / `window` that records its listeners. */
function fakeTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(type: string, fn: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
    fire(type: string) {
      for (const fn of listeners.get(type) ?? []) fn();
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

function harness(hidden = { value: false }) {
  const target = fakeTarget();
  const pageTarget = fakeTarget();
  let flushes = 0;
  const dispose = installFlushOnHide(() => flushes++, {
    target,
    pageTarget,
    isHidden: () => hidden.value,
  });
  return { target, pageTarget, dispose, hidden, flushed: () => flushes };
}

describe('flushing when the page goes away', () => {
  it('flushes when the page becomes hidden', () => {
    const h = harness();
    h.hidden.value = true;
    h.target.fire('visibilitychange');
    expect(h.flushed()).toBe(1);
  });

  it('does not flush when it becomes visible again', () => {
    // Coming back is not a moment of risk, and flushing here would write on
    // every tab switch back.
    const h = harness();
    h.hidden.value = false;
    h.target.fire('visibilitychange');
    expect(h.flushed()).toBe(0);
  });

  it('flushes on pagehide, which the bfcache path takes instead', () => {
    // A page restored from the back/forward cache may never change visibility.
    const h = harness();
    h.pageTarget.fire('pagehide');
    expect(h.flushed()).toBe(1);
  });

  it('flushes once per hide, not once per listener', () => {
    const h = harness();
    h.hidden.value = true;
    h.target.fire('visibilitychange');
    h.target.fire('visibilitychange');
    expect(h.flushed()).toBe(2); // two hides, two flushes
    expect(h.target.count('visibilitychange')).toBe(1);
  });

  it('stops listening when disposed, so a remount cannot double up', () => {
    const h = harness();
    h.dispose();
    expect(h.target.count('visibilitychange')).toBe(0);
    expect(h.pageTarget.count('pagehide')).toBe(0);
    h.hidden.value = true;
    h.target.fire('visibilitychange');
    h.pageTarget.fire('pagehide');
    expect(h.flushed()).toBe(0);
  });
});
